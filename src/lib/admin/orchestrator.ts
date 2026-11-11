/**
 * Orquestrador de compras CCM (Fase 9 v2).
 *
 * Automatiza o pipeline interno:
 *   catálogo → normalização → matching → supplier_offers → ranking → fila de exceções
 *
 * Regras invioláveis:
 *   - NUNCA publica automaticamente
 *   - Auto-sourcing: só se auto_switch_enabled=true E guards passam (ver auto-sourcing.ts)
 *   - NUNCA altera margem automaticamente
 *   - Ambiguidade → procurement_exceptions (revisão humana)
 *
 * Concorrência: lease persistente (orchestrator_lease), fail-closed, com TTL
 * Versionamento: supplier_offers com replaced_at (close+create via version_supplier_offer)
 * Idempotência: fingerprint UNIQUE em exceções abertas
 * Auto-resolução: somente tipos cuja detecção completou com sucesso (detectedTypes)
 */
import { normalizeItems } from "@/lib/normalization/normalizers";
import type { CatalogItemRow, ReferenceData, SubcategoryRef } from "@/lib/normalization/types";
import { buildMasterIndex, matchItems } from "@/lib/matching/engine";
import type { MatchableItem } from "@/lib/matching/types";
import { rankAllProducts } from "@/lib/ranking/engine";
import { resolveMargin, calculatePrice, type MarginRule } from "./pricing";
import { getOperationalSupplierIds } from "./supplier-guards";
import { autoSourceProduct, type AutoSourceResult } from "./auto-sourcing";

import type {
  ProcurementException,
  ExceptionType,
  OrchestratorResult,
  OrchestratorPhaseResult,
  AuditEntry,
  RunStatus,
} from "./orchestrator-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const BATCH_SIZE = 500;
const LEASE_TTL_SECONDS = 300;

async function renewLease(sb: SupabaseClient, runId: string): Promise<boolean> {
  const { data, error } = await sb.rpc("renew_orchestrator_lease", {
    p_run_id: runId,
    p_ttl_seconds: LEASE_TTL_SECONDS,
  });
  if (error || !data?.renewed) return false;
  return true;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

function skippedPhase(name: string): OrchestratorPhaseResult {
  return { phase: name, processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: false };
}

function determineRunStatus(phases: OrchestratorPhaseResult[]): RunStatus {
  const allOk = phases.every((p) => p.ok);
  const noneOk = phases.every((p) => !p.ok);
  if (allOk) return "completed";
  if (noneOk) return "failed";
  return "partial";
}

// ─── Reference data loader ────────────────────────────────────────────────

async function loadReferenceData(sb: SupabaseClient): Promise<ReferenceData> {
  const [brandsRes, catsRes, subsRes] = await Promise.all([
    sb.from("brands").select("slug, name"),
    sb.from("categories").select("slug, name").eq("active", true),
    sb.from("subcategories").select("slug, name, category_slug"),
  ]);

  const brands = new Map<string, string>();
  for (const b of brandsRes.data ?? []) {
    brands.set(normalizeText(b.name), b.slug);
    brands.set(b.slug, b.slug);
  }

  const categories = new Map<string, string>();
  for (const c of catsRes.data ?? []) {
    categories.set(normalizeText(c.name), c.slug);
    categories.set(c.slug, c.slug);
  }

  const subcategories = new Map<string, SubcategoryRef[]>();
  for (const s of subsRes.data ?? []) {
    if (!subcategories.has(s.category_slug)) subcategories.set(s.category_slug, []);
    subcategories.get(s.category_slug)!.push({
      slug: s.slug,
      name: s.name,
      normalized: normalizeText(s.name),
    });
  }

  return { brands, categories, subcategories };
}

// ─── Audit logger ──────────────────────────────────────────────────────────

async function logAudit(sb: SupabaseClient, entry: AuditEntry): Promise<void> {
  await sb.from("procurement_audit_log").insert({
    run_id: entry.run_id,
    action: entry.action,
    phase: entry.phase ?? null,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    detail: entry.detail,
  }).select("id").single();
}

// ─── Phase 1: Normalize pending items ──────────────────────────────────────

async function phaseNormalize(
  sb: SupabaseClient,
  runId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "normalize",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: items } = await sb
      .from("supplier_catalog_items")
      .select("id, name, brand, model, ean, unit, pack_info, category_original, subcategory_original, description, supplier_sku, catalog_id")
      .eq("match_status", "pendente");

    if (!items || items.length === 0) return result;

    const refs = await loadReferenceData(sb);
    const catalogItems = items as unknown as (CatalogItemRow & { catalog_id: string })[];
    const normalized = normalizeItems(catalogItems, refs);

    result.processed = items.length;

    const byCatalog = new Map<string, typeof normalized>();
    for (let i = 0; i < normalized.length; i++) {
      const catId = (items[i] as Record<string, unknown>).catalog_id as string;
      if (!byCatalog.has(catId)) byCatalog.set(catId, []);
      byCatalog.get(catId)!.push(normalized[i]);
    }

    for (const [catalogId, batch] of byCatalog) {
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        const payload = chunk.map((n) => ({
          id: n.id,
          normalized_data: n.normalizedData,
          match_status: n.matchStatus,
        }));

        const { data: count, error } = await sb.rpc("update_normalized_items", {
          p_catalog_id: catalogId,
          p_items: payload,
        });

        if (error) {
          result.errors += chunk.length;
        } else {
          result.updated += (count as number) ?? 0;
        }
      }
    }

    await logAudit(sb, {
      run_id: runId,
      action: "normalize_complete",
      phase: "normalize",
      detail: { processed: result.processed, updated: result.updated, errors: result.errors },
    });

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "phase_error", phase: "normalize",
      detail: { error: (err as Error).message },
    }); } catch {}
    return result;
  }
}

// ─── Phase 2: Match normalized items ───────────────────────────────────────

async function phaseMatch(
  sb: SupabaseClient,
  runId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "match",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: rawItems } = await sb
      .from("supplier_catalog_items")
      .select("id, catalog_id, normalized_data")
      .eq("match_status", "normalizado");

    if (!rawItems || rawItems.length === 0) return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: MatchableItem[] = (rawItems as any[])
      .filter((r) => r.normalized_data != null)
      .map((r) => ({
        id: r.id,
        catalog_id: r.catalog_id,
        normalized_data: r.normalized_data!,
      }));

    if (items.length === 0) return result;

    const { data: mastersRaw } = await sb
      .from("master_products")
      .select("id, ean, name, brand_slug, model, category_slug, subcategory_slug, unit, pack_info, specs")
      .eq("active", true);

    const masters = mastersRaw ?? [];
    if (masters.length === 0) {
      result.skipped = items.length;
      return result;
    }

    const idx = buildMasterIndex(masters);
    const matchResults = matchItems(items, idx);
    result.processed = matchResults.length;

    const byCatalog = new Map<string, typeof matchResults>();
    for (let i = 0; i < matchResults.length; i++) {
      const catId = items[i].catalog_id;
      if (!byCatalog.has(catId)) byCatalog.set(catId, []);
      byCatalog.get(catId)!.push(matchResults[i]);
    }

    for (const [catalogId, batch] of byCatalog) {
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        const payload = chunk.map((r) => ({
          id: r.item_id,
          match_status: r.match_status,
          master_product_id: r.master_product_id ?? "",
          match_confidence: r.match_confidence,
          match_signals: r.match_signals,
        }));

        const { data: count, error } = await sb.rpc("update_match_results", {
          p_catalog_id: catalogId,
          p_items: payload,
        });

        if (error) {
          result.errors += chunk.length;
        } else {
          result.updated += (count as number) ?? 0;
        }
      }
    }

    await logAudit(sb, {
      run_id: runId,
      action: "match_complete",
      phase: "match",
      detail: { processed: result.processed, updated: result.updated, errors: result.errors },
    });

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "phase_error", phase: "match",
      detail: { error: (err as Error).message },
    }); } catch {}
    return result;
  }
}

// ─── Phase 3: Version offers from approved matches ─────────────────────────

async function phaseOffers(
  sb: SupabaseClient,
  runId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "offers",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: approved } = await sb
      .from("supplier_catalog_items")
      .select("id, supplier_id, master_product_id, cost_centavos, stock, lead_time_days")
      .eq("match_status", "aprovado")
      .not("master_product_id", "is", null);

    if (!approved || approved.length === 0) return result;

    result.processed = approved.length;

    for (const item of approved) {
      if (item.cost_centavos <= 0) {
        result.skipped++;
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
        result.errors++;
        continue;
      }

      const res = data as { ok?: boolean; action?: string; error?: string; previous_offer_id?: string; previous_cost?: number };
      if (res.error) {
        result.errors++;
      } else if (res.action === "created") {
        result.created++;
      } else if (res.action === "versioned") {
        result.updated++;
        await logAudit(sb, {
          run_id: runId,
          action: "offer_versioned",
          phase: "offers",
          entity_type: "supplier_offer",
          entity_id: item.id,
          detail: {
            master_product_id: item.master_product_id,
            supplier_id: item.supplier_id,
            previous_offer_id: res.previous_offer_id,
            previous_cost: res.previous_cost,
            new_cost: item.cost_centavos,
          },
        });
      } else {
        result.skipped++;
      }
    }

    await logAudit(sb, {
      run_id: runId,
      action: "offers_complete",
      phase: "offers",
      detail: {
        processed: result.processed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      },
    });

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "phase_error", phase: "offers",
      detail: { error: (err as Error).message },
    }); } catch {}
    return result;
  }
}

// ─── Phase 4: Deactivate offers for inactive items ─────────────────────────

async function phaseInactiveItems(
  sb: SupabaseClient,
  runId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "inactive_items",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: suppliers } = await sb
      .from("suppliers")
      .select("id");

    if (!suppliers || suppliers.length === 0) return result;

    for (const s of suppliers) {
      const { data: count, error } = await sb.rpc("deactivate_offers_for_inactive_items", {
        p_supplier_id: s.id,
      });

      if (error) {
        result.errors++;
      } else {
        const deactivated = (count as number) ?? 0;
        result.updated += deactivated;
        result.processed += deactivated;
      }
    }

    if (result.updated > 0) {
      await logAudit(sb, {
        run_id: runId,
        action: "inactive_offers_deactivated",
        phase: "inactive_items",
        detail: { deactivated: result.updated },
      });
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "phase_error", phase: "inactive_items",
      detail: { error: (err as Error).message },
    }); } catch {}
    return result;
  }
}

// ─── Phase 5: Detect exceptions ────────────────────────────────────────────

async function phaseDetectExceptions(
  sb: SupabaseClient,
  runId: string,
): Promise<{ exceptions: ProcurementException[]; phase: OrchestratorPhaseResult; detectedTypes: Set<ExceptionType> }> {
  const exceptions: ProcurementException[] = [];
  const detectedTypes = new Set<ExceptionType>();
  const result: OrchestratorPhaseResult = {
    phase: "detect_exceptions",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  // ── 5a: Review match exceptions ─────────────────────────────────────────
  try {
    const { data: reviewItems } = await sb
      .from("supplier_catalog_items")
      .select("id, name, supplier_id, match_status, match_confidence, master_product_id")
      .in("match_status", ["match_sugerido", "revisao_manual"]);

    for (const item of reviewItems ?? []) {
      exceptions.push({
        type: "review_match",
        severity: item.match_status === "revisao_manual" ? "high" : "medium",
        entity_type: "supplier_catalog_item",
        entity_id: item.id,
        master_product_id: item.master_product_id,
        supplier_id: item.supplier_id,
        title: `Match pendente: ${item.name}`,
        detail: {
          match_status: item.match_status,
          match_confidence: item.match_confidence,
        },
        fingerprint: `review_match:${item.id}`,
      });
    }
    detectedTypes.add("review_match");
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_review_match",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  // ── 5b: Load shared data (offers, rankings, selections, master products) ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentOffers: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rankings: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let selectionsList: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let selOfferMap = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mpMap = new Map<string, any>();
  let sharedDataLoaded = false;
  let operationalIds = new Set<string>();

  try {
    const { data: rawOffers } = await sb
      .from("supplier_offers")
      .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status")
      .eq("status", "ativa")
      .is("replaced_at", null);
    operationalIds = await getOperationalSupplierIds(sb);
    currentOffers = (rawOffers ?? []).filter(
      (o: { supplier_id: string }) => operationalIds.has(o.supplier_id),
    );

    rankings = rankAllProducts(currentOffers);

    const { data: sels } = await sb
      .from("sourcing_selections")
      .select("id, master_product_id, supplier_offer_id")
      .is("replaced_at", null);
    selectionsList = sels ?? [];

    const selOfferIds = [...new Set(selectionsList.map((s: { supplier_offer_id: string }) => s.supplier_offer_id))];
    if (selOfferIds.length > 0) {
      const { data: selOffers } = await sb
        .from("supplier_offers")
        .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status, replaced_at")
        .in("id", selOfferIds);
      selOfferMap = new Map((selOffers ?? []).map((o: { id: string }) => [o.id, o]));
    }

    const mpIds = [...new Set([
      ...rankings.map((r: { master_product_id: string }) => r.master_product_id),
      ...selectionsList.map((s: { master_product_id: string }) => s.master_product_id),
    ])];
    if (mpIds.length > 0) {
      const { data: mps } = await sb
        .from("master_products")
        .select("id, name, category_slug")
        .in("id", mpIds);
      mpMap = new Map((mps ?? []).map((mp: { id: string }) => [mp.id, mp]));
    }

    sharedDataLoaded = true;
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_shared_data",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  // ── 5c: Review ranking + economy opportunity ────────────────────────────
  if (sharedDataLoaded) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const selMap = new Map(selectionsList.map((s: any) => [s.master_product_id, s]));

      for (const ranking of rankings) {
        const mp = mpMap.get(ranking.master_product_id);
        const mpName = mp?.name ?? ranking.master_product_id;

        if (ranking.ambiguous) {
          exceptions.push({
            type: "review_ranking",
            severity: "medium",
            entity_type: "master_product",
            entity_id: ranking.master_product_id,
            master_product_id: ranking.master_product_id,
            supplier_id: null,
            title: `Ranking ambíguo: ${mpName}`,
            detail: {
              offer_count: ranking.offers.length,
              top_scores: ranking.offers.slice(0, 3).map((o: { supplier_offer_id: string; score_total: number }) => ({
                offer_id: o.supplier_offer_id,
                score: o.score_total,
              })),
            },
            fingerprint: `review_ranking:${ranking.master_product_id}`,
          });
        }

        const sel = selMap.get(ranking.master_product_id);
        if (sel && ranking.recommended_offer_id && ranking.recommended_offer_id !== sel.supplier_offer_id) {
          const selOffer = selOfferMap.get(sel.supplier_offer_id);
          if (selOffer && selOffer.status === "ativa" && selOffer.replaced_at == null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const recOffer = currentOffers.find((o: any) => o.id === ranking.recommended_offer_id);
            if (recOffer && recOffer.cost_centavos < selOffer.cost_centavos) {
              const savings = selOffer.cost_centavos - recOffer.cost_centavos;
              exceptions.push({
                type: "economy_opportunity",
                severity: "low",
                entity_type: "master_product",
                entity_id: ranking.master_product_id,
                master_product_id: ranking.master_product_id,
                supplier_id: recOffer.supplier_id,
                title: `Economia disponível: ${mpName} (-R$ ${(savings / 100).toFixed(2)})`,
                detail: {
                  current_offer_id: sel.supplier_offer_id,
                  current_cost: selOffer.cost_centavos,
                  recommended_offer_id: ranking.recommended_offer_id,
                  recommended_cost: recOffer.cost_centavos,
                  savings_centavos: savings,
                },
                fingerprint: `economy:${ranking.master_product_id}`,
              });
            }
          }
        }
      }
      detectedTypes.add("review_ranking");
      detectedTypes.add("economy_opportunity");
    } catch (err) {
      result.errors++;
      try { await logAudit(sb, {
        run_id: runId, action: "detect_error", phase: "detect_ranking",
        detail: { error: (err as Error).message },
      }); } catch {}
    }
  }

  // ── 5d: Stale sourcing + source_changed (holistic eligibility) ─────────
  if (sharedDataLoaded && selectionsList.length > 0) {
    try {
      for (const sel of selectionsList) {
        const offer = selOfferMap.get(sel.supplier_offer_id);
        const mp = mpMap.get(sel.master_product_id);
        const mpName = mp?.name ?? sel.master_product_id;

        if (!offer) {
          exceptions.push({
            type: "stale_sourcing",
            severity: "critical",
            entity_type: "sourcing_selection",
            entity_id: sel.id,
            master_product_id: sel.master_product_id,
            supplier_id: null,
            title: `Seleção desatualizada: ${mpName}`,
            detail: { selection_id: sel.id, offer_id: sel.supplier_offer_id, reason: "offer_missing" },
            fingerprint: `stale_sourcing:${sel.master_product_id}`,
          });
          continue;
        }

        const ineligible: string[] = [];
        if (offer.replaced_at != null) ineligible.push("offer_replaced");
        if (offer.status !== "ativa") ineligible.push("offer_not_active");
        if (offer.stock != null && offer.stock <= 0) ineligible.push("zero_stock");
        if (offer.cost_centavos <= 0) ineligible.push("invalid_cost");
        if (!operationalIds.has(offer.supplier_id)) ineligible.push("supplier_not_operational");

        if (ineligible.length > 0) {
          const hasCritical = ineligible.some((r) => r !== "zero_stock" && r !== "offer_replaced");
          exceptions.push({
            type: "stale_sourcing",
            severity: hasCritical ? "critical" : "high",
            entity_type: "sourcing_selection",
            entity_id: sel.id,
            master_product_id: sel.master_product_id,
            supplier_id: offer.supplier_id,
            title: `Seleção inelegível: ${mpName}`,
            detail: { selection_id: sel.id, offer_id: sel.supplier_offer_id, reasons: ineligible },
            fingerprint: `stale_sourcing:${sel.master_product_id}`,
          });
          continue;
        }
      }
      detectedTypes.add("stale_sourcing");
      detectedTypes.add("source_changed");
    } catch (err) {
      result.errors++;
      try { await logAudit(sb, {
        run_id: runId, action: "detect_error", phase: "detect_sourcing",
        detail: { error: (err as Error).message },
      }); } catch {}
    }
  }

  // ── 5e: Approved items without active current offer (no_offer) ──────────
  try {
    const { data: approvedNoOffer } = await sb
      .from("supplier_catalog_items")
      .select("id, name, supplier_id, master_product_id")
      .eq("match_status", "aprovado")
      .not("master_product_id", "is", null);

    const offerKeySet = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentOffers.map((o: any) => `${o.master_product_id}:${o.supplier_id}`),
    );

    for (const item of approvedNoOffer ?? []) {
      const key = `${item.master_product_id}:${item.supplier_id}`;
      if (!offerKeySet.has(key)) {
        exceptions.push({
          type: "no_offer",
          severity: "high",
          entity_type: "supplier_catalog_item",
          entity_id: item.id,
          master_product_id: item.master_product_id,
          supplier_id: item.supplier_id,
          title: `Sem oferta ativa: ${item.name}`,
          detail: { catalog_item_id: item.id },
          fingerprint: `no_offer:${item.master_product_id}:${item.supplier_id}`,
        });
      }
    }
    detectedTypes.add("no_offer");
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_no_offer",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  // ── 5e2: Normalized items with no master candidate (no_master_candidate) ─
  try {
    const { data: noMasterItems } = await sb
      .from("supplier_catalog_items")
      .select("id, name, supplier_id")
      .eq("match_status", "normalizado")
      .is("master_product_id", null);

    for (const item of noMasterItems ?? []) {
      exceptions.push({
        type: "no_master_candidate",
        severity: "medium",
        entity_type: "supplier_catalog_item",
        entity_id: item.id,
        master_product_id: null,
        supplier_id: item.supplier_id,
        title: `Sem produto mestre: ${item.name}`,
        detail: { match_status: "normalizado" },
        fingerprint: `no_master_candidate:${item.id}`,
      });
    }
    detectedTypes.add("no_master_candidate");
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_no_master_candidate",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  // ── 5f: Stale publication detection ─────────────────────────────────────
  try {
    const { data: publishedProducts } = await sb
      .from("products")
      .select("id, master_product_id, winning_offer_id, cost_centavos, margin_pct, retail_price, sourcing_selection_id, publish_status")
      .in("publish_status", ["publicada"]);

    const { data: marginRules } = await sb
      .from("margin_rules")
      .select("id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active")
      .eq("active", true);

    const allRules = ((marginRules ?? []) as MarginRule[]).map((r) => ({
      ...r,
      margin_pct: Number(r.margin_pct),
      min_price_centavos: r.min_price_centavos != null ? Number(r.min_price_centavos) : null,
      priority: Number(r.priority),
    }));

    const pubOfferIds = [...new Set(
      (publishedProducts ?? [])
        .map((p: { winning_offer_id: string }) => p.winning_offer_id)
        .filter(Boolean),
    )];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pubOfferMap = new Map<string, any>();
    if (pubOfferIds.length > 0) {
      const { data: pubOffers } = await sb
        .from("supplier_offers")
        .select("id, cost_centavos, stock, status, replaced_at")
        .in("id", pubOfferIds);
      pubOfferMap = new Map((pubOffers ?? []).map((o: { id: string }) => [o.id, o]));
    }

    for (const prod of publishedProducts ?? []) {
      if (!prod.master_product_id || !prod.winning_offer_id) continue;

      const offer = pubOfferMap.get(prod.winning_offer_id);
      const mp = mpMap.get(prod.master_product_id);
      const mpName = mp?.name ?? prod.id;

      if (!offer || offer.replaced_at != null || offer.status !== "ativa") {
        const reason = !offer ? "offer_missing" : offer.replaced_at ? "offer_versioned" : "offer_inactive";
        exceptions.push({
          type: "stale_publication",
          severity: "critical",
          entity_type: "product",
          entity_id: prod.id,
          master_product_id: prod.master_product_id,
          supplier_id: null,
          title: `Publicação desatualizada: ${mpName}`,
          detail: { product_id: prod.id, reason },
          fingerprint: `stale_pub:${prod.id}`,
        });
        continue;
      }

      const mr = resolveMargin(allRules, prod.master_product_id, mp?.category_slug ?? null);

      if (!mr || !mr.ok) {
        exceptions.push({
          type: "stale_publication",
          severity: "critical",
          entity_type: "product",
          entity_id: prod.id,
          master_product_id: prod.master_product_id,
          supplier_id: null,
          title: `Publicação sem margem definida: ${mpName}`,
          detail: {
            product_id: prod.id,
            reason: mr ? "ambiguous_margin" : "no_margin_rule",
            tied_rules: mr && !mr.ok ? mr.tied.map((r) => r.id) : undefined,
          },
          fingerprint: `stale_pub:${prod.id}`,
        });
        continue;
      }

      const costChanged = offer.cost_centavos !== prod.cost_centavos;
      const pricing = calculatePrice(offer.cost_centavos, mr);
      const currentRetailCentavos = Math.round(Number(prod.retail_price) * 100);
      const priceChanged = pricing.rounded_price_centavos !== currentRetailCentavos;

      if (costChanged || priceChanged) {
        exceptions.push({
          type: "stale_publication",
          severity: "high",
          entity_type: "product",
          entity_id: prod.id,
          master_product_id: prod.master_product_id,
          supplier_id: null,
          title: `Publicação desatualizada: ${mpName}`,
          detail: {
            product_id: prod.id,
            cost_changed: costChanged,
            price_changed: priceChanged,
            current_cost: prod.cost_centavos,
            offer_cost: offer.cost_centavos,
          },
          fingerprint: `stale_pub:${prod.id}`,
        });
      }
    }
    detectedTypes.add("stale_publication");
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_publication",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  // ── 5g: Inactive item exceptions ────────────────────────────────────────
  try {
    const { data: inactiveWithOffers } = await sb
      .from("supplier_catalog_items")
      .select("id, name, supplier_id, master_product_id")
      .eq("source_active", false)
      .eq("match_status", "aprovado");

    for (const item of inactiveWithOffers ?? []) {
      if (!item.master_product_id) continue;
      exceptions.push({
        type: "inactive_item",
        severity: "medium",
        entity_type: "supplier_catalog_item",
        entity_id: item.id,
        master_product_id: item.master_product_id,
        supplier_id: item.supplier_id,
        title: `Item inativo do fornecedor: ${item.name}`,
        detail: { catalog_item_id: item.id },
        fingerprint: `inactive:${item.id}`,
      });
    }
    detectedTypes.add("inactive_item");
  } catch (err) {
    result.errors++;
    try { await logAudit(sb, {
      run_id: runId, action: "detect_error", phase: "detect_inactive",
      detail: { error: (err as Error).message },
    }); } catch {}
  }

  result.processed = exceptions.length;
  result.ok = detectedTypes.size > 0;

  try { await logAudit(sb, {
    run_id: runId,
    action: "detect_exceptions_complete",
    phase: "detect_exceptions",
    detail: {
      total_exceptions: exceptions.length,
      detected_types: [...detectedTypes],
      by_type: exceptions.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
  }); } catch {}

  return { exceptions, phase: result, detectedTypes };
}

// ─── Phase 6: Persist exceptions (with safe dedup + auto-resolution) ─────

async function phasePersistExceptions(
  sb: SupabaseClient,
  runId: string,
  exceptions: ProcurementException[],
  detectedTypes: Set<ExceptionType>,
): Promise<{ created: number; autoResolved: number }> {
  let created = 0;
  let autoResolved = 0;

  const newFingerprints = new Set(exceptions.map((e) => e.fingerprint));

  const { data: openExceptions } = await sb
    .from("procurement_exceptions")
    .select("id, fingerprint, type")
    .eq("status", "open");

  for (const ex of openExceptions ?? []) {
    if (
      !newFingerprints.has(ex.fingerprint) &&
      detectedTypes.has(ex.type as ExceptionType)
    ) {
      await sb.rpc("resolve_procurement_exception", {
        p_exception_id: ex.id,
        p_resolution: "resolved",
        p_note: "Auto-resolvida pelo orquestrador.",
      });
      autoResolved++;
    }
  }

  const existingFingerprints = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (openExceptions ?? []).map((e: any) => e.fingerprint),
  );

  for (const exc of exceptions) {
    if (existingFingerprints.has(exc.fingerprint)) continue;

    const { error } = await sb.from("procurement_exceptions").insert({
      type: exc.type,
      severity: exc.severity,
      status: "open",
      entity_type: exc.entity_type,
      entity_id: exc.entity_id,
      master_product_id: exc.master_product_id,
      supplier_id: exc.supplier_id,
      title: exc.title,
      detail: exc.detail,
      fingerprint: exc.fingerprint,
    }).select("id").single();

    if (!error) created++;
  }

  await logAudit(sb, {
    run_id: runId,
    action: "persist_exceptions_complete",
    phase: "persist_exceptions",
    detail: {
      created,
      auto_resolved: autoResolved,
      detected_types: [...detectedTypes],
    },
  });

  return { created, autoResolved };
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function runOrchestrator(
  sb: SupabaseClient,
): Promise<OrchestratorResult> {
  const runId = generateRunId();
  const start = Date.now();
  const phases: OrchestratorPhaseResult[] = [];
  let leaseAcquired = false;

  try {
    // ── Acquire lease (fail-closed) ───────────────────────────────────────
    const { data: leaseData, error: leaseError } = await sb.rpc(
      "acquire_orchestrator_lease",
      { p_run_id: runId, p_ttl_seconds: LEASE_TTL_SECONDS },
    );

    if (leaseError || !leaseData?.acquired) {
      const reason = leaseError?.message
        ?? leaseData?.error
        ?? `Lease mantido por ${leaseData?.held_by ?? "outro processo"} até ${leaseData?.expires_at ?? "?"}`;
      return {
        status: "failed",
        run_id: runId,
        phases: [],
        exceptions_created: 0,
        exceptions_auto_resolved: 0,
        duration_ms: Date.now() - start,
        error: `Não foi possível adquirir lease: ${reason}`,
      };
    }
    leaseAcquired = true;

    await logAudit(sb, {
      run_id: runId,
      action: "orchestrator_start",
      detail: { recovered_from: leaseData.recovered_from ?? null },
    });

    // ── Phase 1: Normalize (independent) ──────────────────────────────────
    const normalizeResult = await phaseNormalize(sb, runId);
    phases.push(normalizeResult);

    // ── Renew lease before Phase 2 ───────────────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "normalize" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após normalize." };
    }

    // ── Phase 2: Match (depends on normalize) ─────────────────────────────
    const matchResult = normalizeResult.ok
      ? await phaseMatch(sb, runId)
      : skippedPhase("match");
    phases.push(matchResult);

    // ── Renew lease before Phase 3 ───────────────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "match" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após match." };
    }

    // ── Phase 3: Offers (depends on match) ────────────────────────────────
    const offersResult = matchResult.ok
      ? await phaseOffers(sb, runId)
      : skippedPhase("offers");
    phases.push(offersResult);

    // ── Renew lease before Phase 4 ───────────────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "offers" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após offers." };
    }

    // ── Phase 4: Inactive items (independent) ─────────────────────────────
    const inactiveResult = await phaseInactiveItems(sb, runId);
    phases.push(inactiveResult);

    // ── Renew lease before Phase 5 ───────────────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "inactive_items" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após inactive_items." };
    }

    // ── Phase 5: Detect exceptions (independent) ──────────────────────────
    const { exceptions, phase: detectPhase, detectedTypes } =
      await phaseDetectExceptions(sb, runId);
    phases.push(detectPhase);

    // ── Renew lease before auto-resolution ─────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "detect_exceptions" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após detect_exceptions." };
    }

    // ── Phase 5b: Auto-resolve stale_sourcing via auto-sourcing ──────────
    const autoResolutionResults: AutoSourceResult[] = [];
    if (detectedTypes.has("stale_sourcing")) {
      const staleExcs = exceptions.filter((e) => e.type === "stale_sourcing" && e.master_product_id);
      for (const exc of staleExcs) {
        try {
          const asr = await autoSourceProduct(sb, exc.master_product_id!, "ineligible");
          autoResolutionResults.push(asr);
          if (asr.action === "selected" || asr.action === "switched") {
            const idx = exceptions.indexOf(exc);
            if (idx !== -1) exceptions.splice(idx, 1);
          }
        } catch {
          // auto-sourcing failure → keep exception for human review
        }
      }

      if (autoResolutionResults.length > 0) {
        const resolved = autoResolutionResults.filter((r) => r.action === "selected" || r.action === "switched").length;
        try { await logAudit(sb, {
          run_id: runId,
          action: "auto_sourcing_resolution",
          phase: "auto_resolve",
          detail: {
            attempted: autoResolutionResults.length,
            resolved,
            by_action: autoResolutionResults.reduce((acc, r) => {
              acc[r.action] = (acc[r.action] ?? 0) + 1;
              return acc;
            }, {} as Record<string, number>),
          },
        }); } catch {}
      }
    }

    // ── Renew lease before Phase 6 ───────────────────────────────────────
    if (!(await renewLease(sb, runId))) {
      try { await logAudit(sb, { run_id: runId, action: "lease_lost", detail: { after_phase: "auto_resolve" } }); } catch {}
      return { status: "failed", run_id: runId, phases, exceptions_created: 0, exceptions_auto_resolved: 0, duration_ms: Date.now() - start, error: "Lease perdido após auto_resolve." };
    }

    // ── Phase 6: Persist exceptions ───────────────────────────────────────
    const { created: exceptionsCreated, autoResolved } =
      await phasePersistExceptions(sb, runId, exceptions, detectedTypes);

    // ── Determine run status ──────────────────────────────────────────────
    const status = determineRunStatus(phases);

    await logAudit(sb, {
      run_id: runId,
      action: "orchestrator_complete",
      detail: {
        status,
        phases: phases.map((p) => ({
          phase: p.phase,
          processed: p.processed,
          created: p.created,
          updated: p.updated,
          errors: p.errors,
          ok: p.ok,
        })),
        exceptions_created: exceptionsCreated,
        exceptions_auto_resolved: autoResolved,
        duration_ms: Date.now() - start,
      },
    });

    return {
      status,
      run_id: runId,
      phases,
      exceptions_created: exceptionsCreated,
      exceptions_auto_resolved: autoResolved,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const errorMessage = (err as Error).message;

    try { await logAudit(sb, {
      run_id: runId,
      action: "orchestrator_complete",
      detail: { status: "failed", error: errorMessage, duration_ms: Date.now() - start },
    }); } catch {}

    return {
      status: "failed",
      run_id: runId,
      phases,
      exceptions_created: 0,
      exceptions_auto_resolved: 0,
      duration_ms: Date.now() - start,
      error: errorMessage,
    };
  } finally {
    if (leaseAcquired) {
      try { await sb.rpc("release_orchestrator_lease", { p_run_id: runId }); } catch {}
    }
  }
}

// ─── Exception data queries ────────────────────────────────────────────────

export interface ExceptionRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  entity_type: string;
  entity_id: string;
  master_product_id: string | null;
  supplier_id: string | null;
  title: string;
  detail: Record<string, unknown>;
  fingerprint: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export async function listExceptions(
  sb: SupabaseClient,
  opts: {
    status?: string;
    type?: string;
    severity?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<{ exceptions: ExceptionRow[]; total: number }> {
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 25;
  const from = (page - 1) * perPage;

  let query = sb
    .from("procurement_exceptions")
    .select(
      "id, type, severity, status, entity_type, entity_id, master_product_id, supplier_id, title, detail, fingerprint, resolved_by, resolved_at, resolution_note, created_at, updated_at",
      { count: "exact", head: false },
    );

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.severity) query = query.eq("severity", opts.severity);

  query = query.order("created_at", { ascending: false }).range(from, from + perPage - 1);

  const { data, count } = await query;

  return {
    exceptions: data ?? [],
    total: count ?? 0,
  };
}

export async function exceptionStats(
  sb: SupabaseClient,
): Promise<Record<string, number>> {
  const types: ExceptionType[] = [
    "review_match", "review_ranking", "no_offer", "no_master_candidate",
    "source_changed", "economy_opportunity", "stale_sourcing", "stale_publication", "inactive_item",
  ];

  const stats: Record<string, number> = { total: 0 };

  for (const t of types) {
    const { count } = await sb
      .from("procurement_exceptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "open")
      .eq("type", t);

    const c = count ?? 0;
    stats[t] = c;
    stats.total += c;
  }

  return stats;
}

export async function lastRunSummary(
  sb: SupabaseClient,
): Promise<{ run_id: string; action: string; detail: Record<string, unknown>; created_at: string } | null> {
  const { data } = await sb
    .from("procurement_audit_log")
    .select("run_id, action, detail, created_at")
    .eq("action", "orchestrator_complete")
    .order("created_at", { ascending: false })
    .limit(1);

  return data?.[0] ?? null;
}
