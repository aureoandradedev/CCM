"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { rankProductOffers } from "@/lib/ranking/engine";
import type { RankableOffer } from "@/lib/ranking/types";
import { getOperationalSupplierIds, filterOperationalOffers } from "@/lib/admin/supplier-guards";
import { slugify } from "@/lib/utils/format";
import { runOrchestrator } from "@/lib/admin/orchestrator";
import type { OrchestratorResult } from "@/lib/admin/orchestrator-types";
import { processCatalogScoped, type ScopedCatalogResult } from "@/lib/admin/catalog-processor";
import { autoSourceProduct, autoSourceProducts, summarizeAutoSourceResults, type AutoSourceResult } from "@/lib/admin/auto-sourcing";
import { recordApprovalBindings } from "@/lib/matching/bindings";

export interface ActionResult {
  ok?: string;
  error?: string;
  orchestratorResult?: OrchestratorResult;
  offerCreated?: boolean;
  autoSourceResult?: AutoSourceResult;
}

// ─── Offer creation after approval ───────────────────────────────────────

async function ensureOfferForApprovedItem(
  sb: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
): Promise<{ ok: boolean; action?: string; error?: string }> {
  const { data: item, error: fetchErr } = await sb
    .from("supplier_catalog_items")
    .select("id, supplier_id, master_product_id, cost_centavos, stock, lead_time_days, match_status")
    .eq("id", itemId)
    .single();

  if (fetchErr || !item) return { ok: false, error: "Item não encontrado." };
  if (item.match_status !== "aprovado") return { ok: false, error: "Item não está aprovado." };
  if (!item.master_product_id) return { ok: false, error: "Item sem master_product_id." };
  if (!item.cost_centavos || item.cost_centavos <= 0) return { ok: true, action: "skipped_invalid_cost" };

  const { data, error } = await sb.rpc("version_supplier_offer", {
    p_master_product_id: item.master_product_id,
    p_supplier_id: item.supplier_id,
    p_catalog_item_id: item.id,
    p_cost_centavos: item.cost_centavos,
    p_stock: item.stock,
    p_lead_time_days: item.lead_time_days ?? 3,
  });

  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; action?: string; error?: string };
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, action: res.action ?? "created" };
}

function friendlyError(raw: string): string {
  if (/Could not find the function/.test(raw)) {
    return "Funcionalidade indisponível — as migrations do banco precisam ser atualizadas. Contate o administrador do sistema.";
  }
  if (/Could not find the table/.test(raw) || /relation .* does not exist/.test(raw)) {
    return "Tabela não encontrada no banco de dados. As migrations precisam ser aplicadas.";
  }
  return raw;
}

async function run(
  fn: (sb: Awaited<ReturnType<typeof createClient>>, adminId: string) => Promise<ActionResult | void>,
): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const sb = await createClient();
    const r = (await fn(sb, admin.id)) ?? {};
    revalidatePath("/admin/compras", "layout");
    if (r.error) r.error = friendlyError(r.error);
    return r;
  } catch (e) {
    const raw = (e as Error).message || "Erro inesperado.";
    return { error: friendlyError(raw) };
  }
}

export async function approveMatch(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const itemId = String(fd.get("itemId") ?? "");
  const masterProductId = String(fd.get("masterProductId") ?? "");
  if (!itemId || !masterProductId) return { error: "Item invalido." };

  return run(async (sb) => {
    const { error } = await sb
      .from("supplier_catalog_items")
      .update({ match_status: "aprovado" })
      .eq("id", itemId)
      .eq("master_product_id", masterProductId)
      .in("match_status", ["match_sugerido", "revisao_manual", "normalizado"]);

    if (error) return { error: error.message };

    // Record matching bindings for future reuse
    const { data: itemData } = await sb
      .from("supplier_catalog_items")
      .select("supplier_id, supplier_sku, ean, name, normalized_data, match_confidence")
      .eq("id", itemId)
      .single();
    if (itemData) {
      const nd = itemData.normalized_data as { name_normalized?: string } | null;
      await recordApprovalBindings(sb, {
        supplierId: itemData.supplier_id,
        supplierSku: itemData.supplier_sku,
        eanClean: itemData.ean?.replace(/[\s\-.\/]/g, "") ?? null,
        nameNormalized: nd?.name_normalized ?? itemData.name,
        masterProductId,
        confidence: itemData.match_confidence ?? 100,
        origin: "admin_approve",
        originItemId: itemId,
      });
    }

    const offerResult = await ensureOfferForApprovedItem(sb, itemId);
    if (!offerResult.ok) {
      return { ok: `Match aprovado. Oferta não criada: ${offerResult.error}`, offerCreated: false };
    }
    const asr = await autoSourceProduct(sb, masterProductId, "new_offer");
    const offerLabel = offerResult.action === "versioned" ? "atualizada" : "criada";
    const autoLabel = asr.action === "selected" ? " Sourcing automático." : asr.action === "disabled" ? "" : ` Auto-sourcing: ${asr.reason}.`;
    return { ok: `Match aprovado. Oferta ${offerLabel}.${autoLabel}`, offerCreated: true, autoSourceResult: asr };
  });
}

export async function rejectMatch(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const itemId = String(fd.get("itemId") ?? "");
  if (!itemId) return { error: "Item invalido." };

  return run(async (sb) => {
    const { error } = await sb
      .from("supplier_catalog_items")
      .update({
        match_status: "rejeitado",
        master_product_id: null,
        match_confidence: null,
        match_signals: null,
      })
      .eq("id", itemId)
      .in("match_status", ["match_sugerido", "revisao_manual"]);

    if (error) return { error: error.message };
    return { ok: "Match rejeitado." };
  });
}

export async function selectOffer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const masterProductId = String(fd.get("masterProductId") ?? "");
  const offerId = String(fd.get("offerId") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  if (!masterProductId || !offerId) return { error: "Dados invalidos." };

  return run(async (sb, adminId) => {
    const { data: rawOffers } = await sb
      .from("supplier_offers")
      .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status")
      .eq("master_product_id", masterProductId)
      .eq("status", "ativa")
      .is("replaced_at", null);

    const operationalIds = await getOperationalSupplierIds(sb);
    const offers: RankableOffer[] = filterOperationalOffers(
      (rawOffers ?? []).map((o) => ({
        id: o.id as string,
        master_product_id: o.master_product_id as string,
        supplier_id: o.supplier_id as string,
        cost_centavos: o.cost_centavos as number,
        stock: o.stock as number | null,
        lead_time_days: o.lead_time_days as number,
        status: o.status as string,
      })),
      operationalIds,
    );

    const ranking = rankProductOffers(offers);
    const ranked = ranking?.offers.find((ro) => ro.supplier_offer_id === offerId);

    const snapshot = ranking
      ? {
          offers: ranking.offers.map((ro) => ({
            offer_id: ro.supplier_offer_id,
            supplier_id: ro.supplier_id,
            score: ro.score_total,
            position: ro.position,
          })),
        }
      : null;

    const { error } = await sb.rpc("select_sourcing_offer", {
      p_master_product_id: masterProductId,
      p_supplier_offer_id: offerId,
      p_selected_by: adminId,
      p_note: note || null,
      p_score: ranked?.score_total ?? null,
      p_ambiguous: ranking?.ambiguous ?? false,
      p_ranking_snapshot: snapshot,
    });

    if (error) return { error: error.message };
    return { ok: "Oferta selecionada com sucesso." };
  });
}

export async function publishProduct(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const masterProductId = String(fd.get("masterProductId") ?? "");
  const sourcingSelectionId = String(fd.get("sourcingSelectionId") ?? "");
  const marginRuleId = String(fd.get("marginRuleId") ?? "");
  const expectedCostCentavos = Number(fd.get("expectedCostCentavos") ?? 0);
  const expectedRetailCentavos = Number(fd.get("expectedRetailCentavos") ?? 0);
  const note = String(fd.get("note") ?? "").trim();
  if (!masterProductId || !sourcingSelectionId || !marginRuleId || !expectedCostCentavos) return { error: "Dados invalidos." };

  return run(async (sb) => {
    const { data: mp } = await sb
      .from("master_products")
      .select("name, ean")
      .eq("id", masterProductId)
      .single();
    if (!mp) return { error: "Produto mestre nao encontrado." };

    const { data: existing } = await sb
      .from("products")
      .select("id")
      .eq("master_product_id", masterProductId)
      .in("publish_status", ["publicada", "rascunho", "aguardando_aprovacao"])
      .maybeSingle();

    const productSlug = slugify(mp.name) + (mp.ean ? `-${mp.ean}` : "");
    const productId = existing?.id as string ?? `ccm-${masterProductId.slice(0, 8)}`;
    const productSku = `CCM-${(mp.ean || masterProductId.slice(0, 8)).toUpperCase()}`;

    const { data, error } = await sb.rpc("publish_product", {
      p_master_product_id: masterProductId,
      p_sourcing_selection_id: sourcingSelectionId,
      p_margin_rule_id: marginRuleId,
      p_expected_cost_centavos: expectedCostCentavos,
      p_expected_retail_centavos: expectedRetailCentavos,
      p_product_id: productId,
      p_product_slug: productSlug,
      p_product_sku: productSku,
      p_note: note || null,
    });

    if (error) return { error: error.message };

    const result = data as { ok?: string; error?: string };
    if (result.error) return { error: result.error };

    revalidatePath("/", "layout");
    return { ok: result.ok ?? "Produto publicado." };
  });
}

// ─── Criar produto mestre a partir de item ────────────────────────────────

export async function createMasterFromItem(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const itemId = String(fd.get("itemId") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const brandSlug = String(fd.get("brandSlug") ?? "").trim() || null;
  const brandName = String(fd.get("brandName") ?? "").trim() || null;
  const model = String(fd.get("model") ?? "").trim() || null;
  const ean = String(fd.get("ean") ?? "").trim() || null;
  const categorySlug = String(fd.get("categorySlug") ?? "").trim() || null;
  const subcategorySlug = String(fd.get("subcategorySlug") ?? "").trim() || null;
  const unit = String(fd.get("unit") ?? "un").trim();
  if (!itemId || !name) return { error: "Item e nome são obrigatórios." };

  return run(async (sb) => {
    const { data: item } = await sb
      .from("supplier_catalog_items")
      .select("id, match_status")
      .eq("id", itemId)
      .single();
    if (!item) return { error: "Item não encontrado." };

    let resolvedBrandSlug = brandSlug;
    if (brandSlug) {
      const { data: existing } = await sb.from("brands").select("slug").eq("slug", brandSlug).maybeSingle();
      if (!existing) {
        const { error: brandErr } = await sb.from("brands").insert({ slug: brandSlug, name: brandName || brandSlug });
        if (brandErr) resolvedBrandSlug = null;
      }
    }

    const { data: master, error: insertErr } = await sb
      .from("master_products")
      .insert({
        name,
        brand_slug: resolvedBrandSlug,
        brand_name: brandName,
        model,
        ean,
        category_slug: categorySlug || null,
        subcategory_slug: subcategorySlug || null,
        unit,
      })
      .select("id")
      .single();

    if (insertErr) return { error: insertErr.message };

    const { error: linkErr } = await sb
      .from("supplier_catalog_items")
      .update({
        master_product_id: master.id,
        match_status: "aprovado",
        match_confidence: 100,
        match_signals: [{ signal: "admin_created_master", weight: 100, matched: true, detail: "Produto mestre criado pelo admin" }],
      })
      .eq("id", itemId);

    if (linkErr) return { error: linkErr.message };

    // Record matching bindings for future reuse
    const { data: itemData } = await sb
      .from("supplier_catalog_items")
      .select("supplier_id, supplier_sku, ean, name, normalized_data")
      .eq("id", itemId)
      .single();
    if (itemData) {
      const nd = itemData.normalized_data as { name_normalized?: string } | null;
      await recordApprovalBindings(sb, {
        supplierId: itemData.supplier_id,
        supplierSku: itemData.supplier_sku,
        eanClean: itemData.ean?.replace(/[\s\-.\/]/g, "") ?? null,
        nameNormalized: nd?.name_normalized ?? itemData.name,
        masterProductId: master.id,
        confidence: 100,
        origin: "admin_create",
        originItemId: itemId,
      });
    }

    const offerResult = await ensureOfferForApprovedItem(sb, itemId);
    if (!offerResult.ok) {
      return { ok: `Produto mestre "${name}" criado e item vinculado. Oferta não criada: ${offerResult.error}`, offerCreated: false };
    }
    const asr = await autoSourceProduct(sb, master.id, "first_selection");
    const offerLabel = offerResult.action === "versioned" ? "atualizada" : "criada";
    const autoLabel = asr.action === "selected" ? " Sourcing automático." : asr.action === "disabled" ? "" : ` Auto-sourcing: ${asr.reason}.`;
    return { ok: `Produto mestre "${name}" criado, oferta ${offerLabel}.${autoLabel}`, offerCreated: true, autoSourceResult: asr };
  });
}

// ─── Associar item a master existente ─────────────────────────────────────

export async function associateToMaster(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const itemId = String(fd.get("itemId") ?? "");
  const masterProductId = String(fd.get("masterProductId") ?? "");
  if (!itemId || !masterProductId) return { error: "Item e produto mestre são obrigatórios." };

  return run(async (sb) => {
    const { data: master } = await sb
      .from("master_products")
      .select("id, name")
      .eq("id", masterProductId)
      .single();
    if (!master) return { error: "Produto mestre não encontrado." };

    const { error } = await sb
      .from("supplier_catalog_items")
      .update({
        master_product_id: masterProductId,
        match_status: "aprovado",
        match_confidence: 100,
        match_signals: [{ signal: "admin_manual_association", weight: 100, matched: true, detail: `Associado manualmente a "${master.name}"` }],
      })
      .eq("id", itemId);

    if (error) return { error: error.message };

    // Record matching bindings for future reuse
    const { data: itemData } = await sb
      .from("supplier_catalog_items")
      .select("supplier_id, supplier_sku, ean, name, normalized_data")
      .eq("id", itemId)
      .single();
    if (itemData) {
      const nd = itemData.normalized_data as { name_normalized?: string } | null;
      await recordApprovalBindings(sb, {
        supplierId: itemData.supplier_id,
        supplierSku: itemData.supplier_sku,
        eanClean: itemData.ean?.replace(/[\s\-.\/]/g, "") ?? null,
        nameNormalized: nd?.name_normalized ?? itemData.name,
        masterProductId,
        confidence: 100,
        origin: "admin_associate",
        originItemId: itemId,
      });
    }

    const offerResult = await ensureOfferForApprovedItem(sb, itemId);
    if (!offerResult.ok) {
      return { ok: `Item vinculado a "${master.name}". Oferta não criada: ${offerResult.error}`, offerCreated: false };
    }
    const asr = await autoSourceProduct(sb, masterProductId, "new_offer");
    const offerLabel = offerResult.action === "versioned" ? "atualizada" : "criada";
    const autoLabel = asr.action === "selected" ? " Sourcing automático." : asr.action === "disabled" ? "" : ` Auto-sourcing: ${asr.reason}.`;
    return { ok: `Item vinculado a "${master.name}", oferta ${offerLabel}.${autoLabel}`, offerCreated: true, autoSourceResult: asr };
  });
}

// ─── Buscar masters (para o modal de associação) ──────────────────────────

export async function searchMasters(query: string): Promise<{ id: string; name: string; brand_slug: string | null; model: string | null; ean: string | null }[]> {
  try {
    await assertAdmin();
    const sb = await createClient();
    const q = query.trim();
    if (!q) return [];

    const { data } = await sb
      .from("master_products")
      .select("id, name, brand_slug, model, ean")
      .or(`name.ilike.%${q}%,brand_slug.ilike.%${q}%,model.ilike.%${q}%,ean.ilike.%${q}%`)
      .order("name")
      .limit(20);

    return (data ?? []) as { id: string; name: string; brand_slug: string | null; model: string | null; ean: string | null }[];
  } catch {
    return [];
  }
}

// ─── Rejeitar item normalizado (ignorar) ──────────────────────────────────

export async function rejectNormalizedItem(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const itemId = String(fd.get("itemId") ?? "");
  if (!itemId) return { error: "Item inválido." };

  return run(async (sb) => {
    const { error } = await sb
      .from("supplier_catalog_items")
      .update({
        match_status: "rejeitado",
        master_product_id: null,
        match_confidence: null,
        match_signals: null,
      })
      .eq("id", itemId)
      .eq("match_status", "normalizado");

    if (error) return { error: error.message };
    return { ok: "Item ignorado." };
  });
}

// ─── Orquestrador ──────────────────────────────────────────────────────────

export async function processarPendencias(_prev: ActionResult): Promise<ActionResult> {
  return run(async (sb) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runOrchestrator(sb as any);
    if (result.status === "failed") {
      return { error: result.error ?? "Erro ao executar orquestrador." };
    }

    const statusLabel = result.status === "completed" ? "concluído" : "parcial (algumas fases falharam)";
    const summary = result.phases
      .filter((p) => p.processed > 0)
      .map((p) => `${p.phase}: ${p.processed} processados${p.ok ? "" : " (com erros)"}`)
      .join(", ");

    return {
      ok: `Orquestrador ${statusLabel} (${result.duration_ms}ms). ${summary || "Nenhum item pendente."}. Exceções: +${result.exceptions_created} novas, ${result.exceptions_auto_resolved} auto-resolvidas.`,
      orchestratorResult: result,
    };
  });
}

// ─── Processamento scoped de catálogo ─────────────────────────────────

export interface CatalogProcessActionResult {
  ok?: string;
  error?: string;
  scopedResult?: ScopedCatalogResult;
}

export async function processarCatalogo(catalogId: string): Promise<CatalogProcessActionResult> {
  if (!catalogId) return { error: "Catálogo inválido." };

  try {
    await assertAdmin();
    const sb = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await processCatalogScoped(sb as any, catalogId);

    if (result.status === "failed") {
      return { error: friendlyError(result.error ?? "Erro ao processar catálogo.") };
    }

    const summary = result.phases
      .filter((p) => p.processed > 0)
      .map((p) => `${p.phase}: ${p.processed} processados`)
      .join(", ");

    revalidatePath("/admin/compras", "layout");

    return {
      ok: `Catálogo processado (${result.duration_ms}ms). ${summary || "Nenhum item pendente."}`,
      scopedResult: result,
    };
  } catch (e) {
    const raw = (e as Error).message || "Erro inesperado.";
    return { error: friendlyError(raw) };
  }
}

// ─── Backfill offers for approved items missing them ─────────────────────

export async function backfillApprovedOffers(): Promise<ActionResult> {
  return run(async (sb) => {
    const { data: approvedItems } = await sb
      .from("supplier_catalog_items")
      .select("id, supplier_id, master_product_id, cost_centavos, stock, lead_time_days")
      .eq("match_status", "aprovado")
      .not("master_product_id", "is", null);

    if (!approvedItems || approvedItems.length === 0) return { ok: "Nenhum item aprovado." };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of approvedItems) {
      if (!item.cost_centavos || item.cost_centavos <= 0) {
        skipped++;
        continue;
      }

      const { data: existing } = await sb
        .from("supplier_offers")
        .select("id")
        .eq("master_product_id", item.master_product_id)
        .eq("supplier_id", item.supplier_id)
        .eq("status", "ativa")
        .is("replaced_at", null)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const { data, error } = await sb.rpc("version_supplier_offer", {
        p_master_product_id: item.master_product_id,
        p_supplier_id: item.supplier_id,
        p_catalog_item_id: item.id,
        p_cost_centavos: item.cost_centavos,
        p_stock: item.stock,
        p_lead_time_days: item.lead_time_days ?? 3,
      });

      if (error) {
        errors++;
        continue;
      }

      const res = data as { action?: string; error?: string };
      if (res.error) {
        errors++;
      } else if (res.action === "created") {
        created++;
      } else if (res.action === "versioned") {
        updated++;
      } else {
        skipped++;
      }
    }

    return { ok: `Backfill: ${created} criadas, ${updated} atualizadas, ${skipped} já existentes, ${errors} erros. Total aprovados: ${approvedItems.length}` };
  });
}

// ─── Exceções ──────────────────────────────────────────────────────────────

export async function resolveException(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const exceptionId = String(fd.get("exceptionId") ?? "");
  const resolution = String(fd.get("resolution") ?? "resolved");
  const note = String(fd.get("note") ?? "").trim();
  if (!exceptionId) return { error: "Exceção inválida." };

  return run(async (sb) => {
    const { data, error } = await sb.rpc("resolve_procurement_exception", {
      p_exception_id: exceptionId,
      p_resolution: resolution,
      p_note: note || null,
    });

    if (error) return { error: error.message };

    const result = data as { ok?: string; error?: string };
    if (result.error) return { error: result.error };
    return { ok: result.ok ?? "Exceção resolvida." };
  });
}
