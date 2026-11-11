import type { SupabaseClient } from "@supabase/supabase-js";

import { rankProductOffers } from "@/lib/ranking/engine";
import type { RankableOffer, ProductRanking } from "@/lib/ranking/types";
import {
  getOperationalSupplierIds,
  filterOperationalOffers,
} from "./supplier-guards";
import {
  resolveMargin,
  calculatePrice,
  type MarginRule,
} from "./pricing";

// ── Types ───────────────────────────────────────────────────────────────────

export type AutoSourceTrigger =
  | "first_selection"
  | "ineligible"
  | "new_offer";

export interface AutoSourceResult {
  masterProductId: string;
  action:
    | "disabled"
    | "selected"
    | "switched"
    | "noop"
    | "pendencia"
    | "error";
  reason: string;
  offerId?: string;
  supplierId?: string;
  oldOfferId?: string;
  oldSupplierId?: string;
  pricingAction?: "auto_applied" | "no_change" | "not_published";
  changePct?: number;
}

interface PricingSimulation {
  published: boolean;
  productId?: string;
  categorySlug?: string | null;
  oldPriceCentavos?: number;
  newPriceCentavos?: number;
  changePct?: number;
  limitPct?: number;
  safe: boolean;
  reason?: string;
}

// ── Config reader ───────────────────────────────────────────────────────────

async function readFlag(
  sb: SupabaseClient,
  key: string,
): Promise<boolean> {
  const { data } = await sb
    .from("ccm_configs")
    .select("value")
    .eq("key", key)
    .eq("scope", "global")
    .limit(1)
    .single();
  if (!data) return false;
  return data.value === true || data.value === "true";
}

// ── Pricing simulation (pre-check in TS, RPC revalidates) ──────────────────

async function simulatePricingImpact(
  sb: SupabaseClient,
  masterProductId: string,
  newCostCentavos: number,
): Promise<PricingSimulation> {
  const { data: product } = await sb
    .from("products")
    .select("id, retail_price, cost_centavos, category_slug, master_product_id")
    .eq("master_product_id", masterProductId)
    .eq("publish_status", "publicada")
    .eq("active", true)
    .limit(1)
    .single();

  if (!product) return { published: false, safe: true };

  const oldPriceCentavos = Math.round(Number(product.retail_price) * 100);

  const { data: marginRules } = await sb
    .from("margin_rules")
    .select("*")
    .eq("active", true);

  if (!marginRules || marginRules.length === 0) {
    return {
      published: true,
      productId: product.id,
      safe: false,
      reason: "Nenhuma regra de margem ativa.",
    };
  }

  const marginResult = resolveMargin(
    marginRules as MarginRule[],
    masterProductId,
    product.category_slug,
  );

  if (!marginResult) {
    return {
      published: true,
      productId: product.id,
      safe: false,
      reason: "Nenhuma regra de margem aplicavel.",
    };
  }

  if (!marginResult.ok) {
    return {
      published: true,
      productId: product.id,
      safe: false,
      reason: "Regras de margem ambiguas (mesma prioridade).",
    };
  }

  const priceCalc = calculatePrice(newCostCentavos, marginResult);
  const newPriceCentavos = priceCalc.rounded_price_centavos;

  if (newPriceCentavos === oldPriceCentavos) {
    return {
      published: true,
      productId: product.id,
      categorySlug: product.category_slug,
      oldPriceCentavos,
      newPriceCentavos,
      changePct: 0,
      safe: true,
    };
  }

  const changePct =
    oldPriceCentavos > 0
      ? ((newPriceCentavos - oldPriceCentavos) / oldPriceCentavos) * 100
      : 0;

  const { data: sectionConfig } = await sb
    .from("section_configs")
    .select("value")
    .eq("section", product.category_slug ?? "")
    .eq("key", "auto_price_increase_limit_pct")
    .limit(1)
    .single();

  const limitPct = sectionConfig?.value
    ? Number(sectionConfig.value)
    : 10;

  const autoPriceEnabled = await readFlag(sb, "auto_price_enabled");

  if (!autoPriceEnabled) {
    return {
      published: true,
      productId: product.id,
      categorySlug: product.category_slug,
      oldPriceCentavos,
      newPriceCentavos,
      changePct,
      limitPct,
      safe: false,
      reason: "auto_price_enabled desativado e troca exige mudanca de preco.",
    };
  }

  if (changePct > limitPct) {
    return {
      published: true,
      productId: product.id,
      categorySlug: product.category_slug,
      oldPriceCentavos,
      newPriceCentavos,
      changePct,
      limitPct,
      safe: false,
      reason: `Variacao de preco ${changePct.toFixed(1)}% excede limite ${limitPct}%.`,
    };
  }

  return {
    published: true,
    productId: product.id,
    categorySlug: product.category_slug,
    oldPriceCentavos,
    newPriceCentavos,
    changePct,
    limitPct,
    safe: true,
  };
}

// ── Core: auto-source one product ──────────────────────────────────────────

export async function autoSourceProduct(
  sb: SupabaseClient,
  masterProductId: string,
  trigger: AutoSourceTrigger,
): Promise<AutoSourceResult> {
  const base = { masterProductId };

  // 1. Flag check
  const enabled = await readFlag(sb, "auto_switch_enabled");
  if (!enabled) {
    return { ...base, action: "disabled", reason: "auto_switch_enabled OFF" };
  }

  // 2. Fetch active offers
  const { data: rawOffers } = await sb
    .from("supplier_offers")
    .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status")
    .eq("master_product_id", masterProductId)
    .eq("status", "ativa")
    .is("replaced_at", null);

  const allOffers = (rawOffers ?? []) as RankableOffer[];

  // 3. Filter operational
  const opIds = await getOperationalSupplierIds(sb);
  const offers = filterOperationalOffers(allOffers, opIds);

  if (offers.length === 0) {
    return { ...base, action: "pendencia", reason: "sem_fornecedor_elegivel" };
  }

  // 4. Rank
  const ranking: ProductRanking | null = rankProductOffers(offers);
  if (!ranking) {
    return { ...base, action: "pendencia", reason: "ranking_vazio" };
  }

  if (ranking.ambiguous) {
    return { ...base, action: "pendencia", reason: "ranking_ambiguo" };
  }

  if (!ranking.recommended_offer_id) {
    return { ...base, action: "pendencia", reason: "sem_recomendacao" };
  }

  // 5. Current sourcing
  const { data: currentSel } = await sb
    .from("sourcing_selections")
    .select("id, supplier_offer_id")
    .eq("master_product_id", masterProductId)
    .is("replaced_at", null)
    .limit(1)
    .single();

  const currentOfferId = currentSel?.supplier_offer_id ?? null;

  // 6. Already selected
  if (currentOfferId === ranking.recommended_offer_id) {
    return { ...base, action: "noop", reason: "ja_selecionado" };
  }

  // 7. Economy trigger without hysteresis → pendencia (C3)
  if (currentOfferId && trigger !== "ineligible") {
    const currentOffer = allOffers.find((o) => o.id === currentOfferId);
    if (currentOffer && currentOffer.stock != null && currentOffer.stock > 0 && currentOffer.cost_centavos > 0) {
      return {
        ...base,
        action: "pendencia",
        reason: "economy_sem_hysteresis",
        offerId: ranking.recommended_offer_id,
      };
    }
  }

  // 8. Check critical exceptions
  const { count: criticalCount } = await sb
    .from("procurement_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("master_product_id", masterProductId)
    .eq("status", "open")
    .eq("severity", "critical");

  if (criticalCount && criticalCount > 0) {
    return { ...base, action: "pendencia", reason: "excecao_critica_aberta" };
  }

  // 9. Get recommended offer data
  const recommendedOffer = offers.find(
    (o) => o.id === ranking.recommended_offer_id,
  );
  if (!recommendedOffer) {
    return { ...base, action: "error", reason: "offer_recomendada_nao_encontrada" };
  }

  // 10. Simulate pricing impact (pre-check)
  const pricing = await simulatePricingImpact(
    sb,
    masterProductId,
    recommendedOffer.cost_centavos,
  );

  if (!pricing.safe) {
    return {
      ...base,
      action: "pendencia",
      reason: pricing.reason ?? "pricing_inseguro",
      offerId: ranking.recommended_offer_id,
      changePct: pricing.changePct,
    };
  }

  // 11. Build ranking snapshot
  const snapshot = ranking.offers.map((o) => ({
    offer_id: o.supplier_offer_id,
    supplier_id: o.supplier_id,
    score: o.score_total,
    position: o.position,
  }));

  const topOffer = ranking.offers[0];
  const isSwitch = currentOfferId != null;
  const notePrefix = isSwitch ? "[auto-switch]" : "[auto-sourcing]";
  const reason = isSwitch
    ? trigger === "ineligible"
      ? "fornecedor_inelegivel"
      : "economy_opportunity"
    : "primeira_selecao";

  const note = `${notePrefix} ${reason} — score ${topOffer.score_total.toFixed(1)}, ${topOffer.reasons.join(", ")}`;

  // 12. Call transactional RPC
  const rpcParams: Record<string, unknown> = {
    p_master_product_id: masterProductId,
    p_new_offer_id: ranking.recommended_offer_id,
    p_note: note,
    p_score: topOffer.score_total,
    p_ranking_snapshot: snapshot,
    p_reason: reason,
    p_expected_old_offer_id: currentOfferId,
    p_expected_new_cost_centavos: recommendedOffer.cost_centavos,
    p_new_price_centavos: pricing.published ? pricing.newPriceCentavos : null,
  };

  const { data: rpcResult, error: rpcError } = await sb.rpc(
    "auto_switch_sourcing_safe",
    rpcParams,
  );

  if (rpcError) {
    return { ...base, action: "error", reason: rpcError.message };
  }

  const result = rpcResult as {
    ok?: boolean;
    action?: string;
    error?: string;
    new_supplier_id?: string;
    old_supplier_id?: string;
    price_updated?: boolean;
    change_pct?: number;
  };

  if (!result.ok) {
    return {
      ...base,
      action: "pendencia",
      reason: result.error ?? "rpc_rejeitou",
    };
  }

  if (result.action === "noop") {
    return { ...base, action: "noop", reason: "ja_selecionado" };
  }

  return {
    ...base,
    action: result.action === "switched" ? "switched" : "selected",
    reason,
    offerId: ranking.recommended_offer_id,
    supplierId: result.new_supplier_id,
    oldOfferId: currentOfferId ?? undefined,
    oldSupplierId: result.old_supplier_id ?? undefined,
    pricingAction: result.price_updated
      ? "auto_applied"
      : pricing.published
        ? "no_change"
        : "not_published",
    changePct: result.change_pct ?? pricing.changePct,
  };
}

// ── Bulk: auto-source multiple products ────────────────────────────────────

export async function autoSourceProducts(
  sb: SupabaseClient,
  masterProductIds: string[],
  trigger: AutoSourceTrigger,
): Promise<AutoSourceResult[]> {
  const results: AutoSourceResult[] = [];
  for (const id of masterProductIds) {
    const r = await autoSourceProduct(sb, id, trigger);
    results.push(r);
  }
  return results;
}

// ── Summary helper ─────────────────────────────────────────────────────────

export function summarizeAutoSourceResults(
  results: AutoSourceResult[],
): string {
  const selected = results.filter((r) => r.action === "selected").length;
  const switched = results.filter((r) => r.action === "switched").length;
  const noop = results.filter((r) => r.action === "noop").length;
  const pendencia = results.filter((r) => r.action === "pendencia").length;
  const disabled = results.filter((r) => r.action === "disabled").length;
  const errors = results.filter((r) => r.action === "error").length;

  const parts: string[] = [];
  if (selected > 0) parts.push(`${selected} selecionado(s)`);
  if (switched > 0) parts.push(`${switched} trocado(s)`);
  if (noop > 0) parts.push(`${noop} sem alteração`);
  if (pendencia > 0) parts.push(`${pendencia} pendência(s)`);
  if (disabled > 0) parts.push(`${disabled} desativado(s)`);
  if (errors > 0) parts.push(`${errors} erro(s)`);

  return parts.join(", ") || "Nenhum resultado.";
}
