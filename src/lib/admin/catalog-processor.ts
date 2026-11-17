/**
 * Processador scoped de catálogo.
 *
 * Executa normalização → matching → offers APENAS para itens
 * de um catalog_id específico. Reutiliza os mesmos engines
 * (normalizeItems, buildMasterIndex, matchItems, version_supplier_offer)
 * sem tocar no orquestrador global.
 *
 * Idempotente: rodar múltiplas vezes no mesmo catálogo é seguro.
 * Não faz sourcing, não altera thresholds, não auto-publica.
 */

import { normalizeItems } from "@/lib/normalization/normalizers";
import type { CatalogItemRow, ReferenceData, SubcategoryRef } from "@/lib/normalization/types";
import { buildMasterIndex, matchItems } from "@/lib/matching/engine";
import type { MatchableItem, MatchResult } from "@/lib/matching/types";
import type { OrchestratorPhaseResult } from "./orchestrator-types";
import { autoSourceProducts, summarizeAutoSourceResults, type AutoSourceResult } from "./auto-sourcing";
import { lookupSkuBinding, lookupNameBindings, checkBindingGuard, canonicalNameKey } from "@/lib/matching/bindings";
import { MATCH_THRESHOLDS, NAME_BINDING_BOOST } from "@/lib/matching/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ScopedItemReport {
  id: string;
  name: string;
  supplier_sku: string | null;
  ean: string | null;
  before_status: string;
  after_status: string;
  match_confidence: number | null;
  master_product_id: string | null;
  master_product_name: string | null;
  offer_action: string | null;
}

export interface ScopedCatalogResult {
  catalog_id: string;
  phases: OrchestratorPhaseResult[];
  status: "completed" | "partial" | "failed";
  duration_ms: number;
  error?: string;
  item_report: ScopedItemReport[];
  auto_sourcing_summary?: string;
  auto_sourcing_results?: AutoSourceResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

function skippedPhase(name: string): OrchestratorPhaseResult {
  return { phase: name, processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: false };
}

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

// ─── Phase 0: Reuse approved bindings with consistency guard ─────────────
// Primary: matching_bindings table (persistent, auditable)
// Fallback: legacy scan of supplier_catalog_items (pre-migration approvals)
// Guard: EAN + brand/model + hard conflict attributes (voltage, weight, etc.)

async function scopedReuseBindings(
  sb: SupabaseClient,
  catalogId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "reuse_bindings",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: pendingItems } = await sb
      .from("supplier_catalog_items")
      .select("id, supplier_id, supplier_sku, ean, brand, model, name")
      .eq("catalog_id", catalogId)
      .eq("match_status", "pendente");

    if (!pendingItems || pendingItems.length === 0) return result;

    result.processed = pendingItems.length;

    for (const item of pendingItems) {
      if (!item.supplier_sku) {
        result.skipped++;
        continue;
      }

      // ── 1. Try matching_bindings table (primary) ──────────────────────
      const binding = await lookupSkuBinding(sb, item.supplier_id, item.supplier_sku);

      let masterProductId: string | null = null;
      let confidence: number | null = null;
      let reuseSource: string | null = null;

      if (binding) {
        masterProductId = binding.master_product_id;
        confidence = binding.confidence;
        reuseSource = "matching_bindings";
      } else {
        // ── 2. Legacy fallback: scan catalog_items ────────────────────
        const { data: prevItems } = await sb
          .from("supplier_catalog_items")
          .select("id, master_product_id, match_confidence, match_signals")
          .eq("supplier_id", item.supplier_id)
          .eq("supplier_sku", item.supplier_sku)
          .eq("match_status", "aprovado")
          .not("master_product_id", "is", null)
          .neq("catalog_id", catalogId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (prevItems && prevItems.length > 0) {
          masterProductId = prevItems[0].master_product_id;
          confidence = prevItems[0].match_confidence;
          reuseSource = `legacy_item:${prevItems[0].id}`;
        }
      }

      if (!masterProductId) {
        result.skipped++;
        continue;
      }

      // ── 3. Fetch master for guard check ─────────────────────────────
      const { data: master } = await sb
        .from("master_products")
        .select("id, ean, brand_slug, model, name, specs")
        .eq("id", masterProductId)
        .single();

      if (!master) {
        result.skipped++;
        continue;
      }

      // ── 4. Enhanced guard: EAN + brand/model + hard conflicts ───────
      const guard = checkBindingGuard(
        { ean: item.ean, brand: item.brand, model: item.model, name: item.name },
        { ean: master.ean, brand_slug: master.brand_slug, model: master.model, specs: master.specs ?? {} },
      );

      if (!guard.passed) {
        const failSignals = [
          { signal: "binding_guard_failed", weight: 0, matched: false, detail: guard.detail },
        ];
        await sb
          .from("supplier_catalog_items")
          .update({ match_signals: failSignals })
          .eq("id", item.id)
          .eq("catalog_id", catalogId);
        result.skipped++;
        continue;
      }

      // ── 5. Approve automatically ───────────────────────────────────
      const reuseSignals: MatchSignal[] = [
        { signal: "reused_binding", weight: 0, matched: true, detail: `source: ${reuseSource}` },
      ];

      const { error } = await sb
        .from("supplier_catalog_items")
        .update({
          match_status: "aprovado",
          master_product_id: masterProductId,
          match_confidence: confidence,
          match_signals: reuseSignals,
        })
        .eq("id", item.id)
        .eq("catalog_id", catalogId);

      if (error) {
        result.errors++;
      } else {
        result.updated++;
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    return result;
  }
}

// ─── Phase 1: Normalize pending items for this catalog ────────────────────

async function scopedNormalize(
  sb: SupabaseClient,
  catalogId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "normalize",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: items } = await sb
      .from("supplier_catalog_items")
      .select("id, name, brand, model, ean, unit, pack_info, category_original, subcategory_original, description, supplier_sku, catalog_id")
      .eq("catalog_id", catalogId)
      .eq("match_status", "pendente");

    if (!items || items.length === 0) return result;

    const refs = await loadReferenceData(sb);
    const catalogItems = items as unknown as (CatalogItemRow & { catalog_id: string })[];
    const normalized = normalizeItems(catalogItems, refs);

    result.processed = items.length;

    for (const n of normalized) {
      const { error } = await sb
        .from("supplier_catalog_items")
        .update({
          normalized_data: n.normalizedData,
          match_status: n.matchStatus,
        })
        .eq("id", n.id)
        .eq("catalog_id", catalogId);

      if (error) {
        result.errors++;
      } else {
        result.updated++;
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    return result;
  }
}

// ─── Phase 2: Match normalized items for this catalog ─────────────────────

async function scopedMatch(
  sb: SupabaseClient,
  catalogId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "match",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: rawItems } = await sb
      .from("supplier_catalog_items")
      .select("id, catalog_id, normalized_data")
      .eq("catalog_id", catalogId)
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

    // ── Name binding boost (auxiliary evidence) ─────────────────────────
    await applyNameBindingBoost(sb, items, matchResults);

    for (const r of matchResults) {
      const { error } = await sb
        .from("supplier_catalog_items")
        .update({
          match_status: r.match_status,
          master_product_id: r.master_product_id ?? null,
          match_confidence: r.match_confidence,
          match_signals: r.match_signals,
        })
        .eq("id", r.item_id)
        .eq("catalog_id", catalogId);

      if (error) {
        result.errors++;
      } else {
        result.updated++;
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    return result;
  }
}

// ─── Name binding boost (applied after matching, before auto-approve) ───────

async function applyNameBindingBoost(
  sb: SupabaseClient,
  items: MatchableItem[],
  results: MatchResult[],
): Promise<void> {
  const itemMap = new Map(items.map(i => [i.id, i]));
  const nameKeyMap = new Map<string, string>();

  for (const item of items) {
    const nn = item.normalized_data?.name_normalized;
    if (nn) {
      const key = canonicalNameKey(nn);
      if (key) nameKeyMap.set(item.id, key);
    }
  }

  const uniqueKeys = [...new Set(nameKeyMap.values())];
  if (uniqueKeys.length === 0) return;

  const bindingsMap = await lookupNameBindings(sb, uniqueKeys);
  if (bindingsMap.size === 0) return;

  for (const r of results) {
    if (!r.master_product_id) continue;
    if (r.match_status === "match_sugerido") continue;

    const nk = nameKeyMap.get(r.item_id);
    if (!nk) continue;

    const boundMasters = bindingsMap.get(nk);
    if (!boundMasters?.has(r.master_product_id)) continue;

    r.match_confidence += NAME_BINDING_BOOST;
    r.match_signals.push({
      signal: "name_binding_boost",
      weight: NAME_BINDING_BOOST,
      matched: true,
      detail: "nome normalizado com vínculo anterior",
    });

    const hasHardConflict = r.match_signals.some(
      s => s.signal === "hard_conflict_override",
    );
    if (!hasHardConflict && r.match_confidence >= MATCH_THRESHOLDS.HIGH_CONFIDENCE) {
      r.match_status = "match_sugerido";
    } else if (r.match_confidence >= MATCH_THRESHOLDS.REVIEW && r.match_status === "normalizado") {
      r.match_status = "revisao_manual";
    }
  }
}

// ─── Phase 2b: Auto-approve match_sugerido items (technical match) ────────

interface MatchSignal {
  signal: string;
  weight: number;
  matched: boolean;
  detail: string;
}

async function scopedAutoApprove(
  sb: SupabaseClient,
  catalogId: string,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "auto_approve",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: items } = await sb
      .from("supplier_catalog_items")
      .select("id, match_status, match_confidence, match_signals")
      .eq("catalog_id", catalogId)
      .eq("match_status", "match_sugerido");

    if (!items || items.length === 0) return result;

    result.processed = items.length;

    for (const item of items) {
      const confidence = item.match_confidence as number | null;
      const signals = (item.match_signals ?? []) as MatchSignal[];

      const hasHardConflict = signals.some(
        (s: MatchSignal) => s.signal === "hard_conflict_override",
      );
      const hasAmbiguity = signals.some(
        (s: MatchSignal) => s.signal === "ambiguous",
      );

      if (
        confidence != null &&
        confidence >= 75 &&
        !hasHardConflict &&
        !hasAmbiguity
      ) {
        const { error } = await sb
          .from("supplier_catalog_items")
          .update({ match_status: "aprovado" })
          .eq("id", item.id)
          .eq("catalog_id", catalogId);

        if (error) {
          result.errors++;
        } else {
          result.updated++;
        }
      } else {
        result.skipped++;
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    return result;
  }
}

// ─── Phase 3: Create/version offers for approved items in this catalog ────

async function scopedOffers(
  sb: SupabaseClient,
  catalogId: string,
  offerActions: Map<string, string>,
): Promise<OrchestratorPhaseResult> {
  const result: OrchestratorPhaseResult = {
    phase: "offers",
    processed: 0, created: 0, updated: 0, errors: 0, skipped: 0, ok: true,
  };

  try {
    const { data: approved } = await sb
      .from("supplier_catalog_items")
      .select("id, supplier_id, master_product_id, cost_centavos, stock, lead_time_days")
      .eq("catalog_id", catalogId)
      .eq("match_status", "aprovado")
      .not("master_product_id", "is", null);

    if (!approved || approved.length === 0) return result;

    result.processed = approved.length;

    for (const item of approved) {
      if (item.cost_centavos <= 0) {
        result.skipped++;
        offerActions.set(item.id, "skipped_invalid_cost");
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
        offerActions.set(item.id, "error");
        continue;
      }

      const res = data as { ok?: boolean; action?: string; error?: string };
      if (res.error) {
        result.errors++;
        offerActions.set(item.id, "error");
      } else if (res.action === "created") {
        result.created++;
        offerActions.set(item.id, "created");
      } else if (res.action === "versioned") {
        result.updated++;
        offerActions.set(item.id, "versioned");
      } else {
        result.skipped++;
        offerActions.set(item.id, res.action ?? "no_change");
      }
    }

    return result;
  } catch (err) {
    result.ok = false;
    result.errors++;
    return result;
  }
}

// ─── Main: process a single catalog ───────────────────────────────────────

export async function processCatalogScoped(
  sb: SupabaseClient,
  catalogId: string,
): Promise<ScopedCatalogResult> {
  const start = Date.now();
  const phases: OrchestratorPhaseResult[] = [];
  const offerActions = new Map<string, string>();

  try {
    const { data: catalog, error: catErr } = await sb
      .from("supplier_catalogs")
      .select("id, status")
      .eq("id", catalogId)
      .single();

    if (catErr || !catalog) {
      return {
        catalog_id: catalogId,
        phases: [],
        status: "failed",
        duration_ms: Date.now() - start,
        error: "Catálogo não encontrado.",
        item_report: [],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: beforeItems } = await sb
      .from("supplier_catalog_items")
      .select("id, match_status")
      .eq("catalog_id", catalogId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const beforeMap = new Map((beforeItems ?? []).map((i: any) => [i.id as string, i.match_status as string]));

    // Phase 0: Reuse approved bindings (skips items already resolved)
    const reuseResult = await scopedReuseBindings(sb, catalogId);
    phases.push(reuseResult);

    // Phase 1: Normalize (only remaining pendente items)
    const normalizeResult = await scopedNormalize(sb, catalogId);
    phases.push(normalizeResult);

    // Phase 2: Match (depends on normalize)
    const matchResult = normalizeResult.ok
      ? await scopedMatch(sb, catalogId)
      : skippedPhase("match");
    phases.push(matchResult);

    // Phase 2b: Auto-approve match_sugerido (technical match)
    const autoApproveResult = matchResult.ok
      ? await scopedAutoApprove(sb, catalogId)
      : skippedPhase("auto_approve");
    phases.push(autoApproveResult);

    // Phase 3: Offers (depends on match + auto-approve)
    const offersResult = matchResult.ok
      ? await scopedOffers(sb, catalogId, offerActions)
      : skippedPhase("offers");
    phases.push(offersResult);

    // Phase 4: Auto-sourcing for affected master_products
    let autoSourcingResults: AutoSourceResult[] = [];
    let autoSourcingSummary: string | undefined;
    if (offersResult.ok && (offersResult.created > 0 || offersResult.updated > 0)) {
      const { data: affectedItems } = await sb
        .from("supplier_catalog_items")
        .select("master_product_id")
        .eq("catalog_id", catalogId)
        .eq("match_status", "aprovado")
        .not("master_product_id", "is", null);

      const mpIds = [...new Set((affectedItems ?? []).map((i: { master_product_id: string }) => i.master_product_id))] as string[];
      if (mpIds.length > 0) {
        autoSourcingResults = await autoSourceProducts(sb, mpIds, "new_offer");
        autoSourcingSummary = summarizeAutoSourceResults(autoSourcingResults);
      }
    }

    // ── Update catalog counts ─────────────────────────────────────────────
    const { count: totalCount } = await sb
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId);

    const { count: pendingCount } = await sb
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "pendente");

    const { count: errorCount } = await sb
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "rejeitado");

    const processed = (totalCount ?? 0) - (pendingCount ?? 0);
    const newStatus = (pendingCount ?? 0) === 0 ? "analisado" : catalog.status;

    await sb
      .from("supplier_catalogs")
      .update({ processed, errors: errorCount ?? 0, status: newStatus })
      .eq("id", catalogId);

    // ── Build per-item report ─────────────────────────────────────────────
    const { data: afterItems } = await sb
      .from("supplier_catalog_items")
      .select("id, name, supplier_sku, ean, match_status, match_confidence, master_product_id, master_products(name)")
      .eq("catalog_id", catalogId)
      .order("name");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemReport: ScopedItemReport[] = (afterItems ?? []).map((i: any) => ({
      id: i.id,
      name: i.name,
      supplier_sku: i.supplier_sku,
      ean: i.ean,
      before_status: beforeMap.get(i.id) ?? "unknown",
      after_status: i.match_status,
      match_confidence: i.match_confidence,
      master_product_id: i.master_product_id,
      master_product_name: i.master_products?.name ?? null,
      offer_action: offerActions.get(i.id) ?? null,
    }));

    const allOk = phases.every((p) => p.ok);
    const noneOk = phases.every((p) => !p.ok);
    const status = allOk ? "completed" : noneOk ? "failed" : "partial";

    return {
      catalog_id: catalogId,
      phases,
      status,
      duration_ms: Date.now() - start,
      item_report: itemReport,
      auto_sourcing_summary: autoSourcingSummary,
      auto_sourcing_results: autoSourcingResults.length > 0 ? autoSourcingResults : undefined,
    };
  } catch (err) {
    return {
      catalog_id: catalogId,
      phases,
      status: "failed",
      duration_ms: Date.now() - start,
      error: (err as Error).message,
      item_report: [],
    };
  }
}
