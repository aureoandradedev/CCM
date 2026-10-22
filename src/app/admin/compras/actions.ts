"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { rankProductOffers } from "@/lib/ranking/engine";
import type { RankableOffer } from "@/lib/ranking/types";
import { slugify } from "@/lib/utils/format";
import { runOrchestrator } from "@/lib/admin/orchestrator";
import type { OrchestratorResult } from "@/lib/admin/orchestrator-types";

export interface ActionResult {
  ok?: string;
  error?: string;
  orchestratorResult?: OrchestratorResult;
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
      .in("match_status", ["match_sugerido", "revisao_manual"]);

    if (error) return { error: error.message };
    return { ok: "Match aprovado." };
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

    const offers: RankableOffer[] = (rawOffers ?? []).map((o) => ({
      id: o.id as string,
      master_product_id: o.master_product_id as string,
      supplier_id: o.supplier_id as string,
      cost_centavos: o.cost_centavos as number,
      stock: o.stock as number | null,
      lead_time_days: o.lead_time_days as number,
      status: o.status as string,
    }));

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
