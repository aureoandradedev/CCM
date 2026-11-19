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
  pricingAction?: "auto_applied" | "no_change" | "not_published" | "price_blocked";
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
  switchAllowed: boolean;
  reason?: string;
}

// ── Config reader ───────────────────────────────────────────────────────────

async function readFlag(
  sb: SupabaseClient,
  key: string,
  scope = "global",
): Promise<boolean> {
  const { data } = await sb
    .from("ccm_configs")
    .select("value")
    .eq("key", key)
    .eq("scope", scope)
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

  if (!product) return { published: false, safe: true, switchAllowed: true };

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
      switchAllowed: false,
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
      switchAllowed: false,
      reason: "Nenhuma regra de margem aplicavel.",
    };
  }

  if (!marginResult.ok) {
    return {
      published: true,
      productId: product.id,
      safe: false,
      switchAllowed: false,
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
      switchAllowed: true,
    };
  }

  const changePct =
    oldPriceCentavos > 0
      ? ((newPriceCentavos - oldPriceCentavos) / oldPriceCentavos) * 100
      : 0;

  const { data: sectionConfig } = await sb
    .from("section_configs")
    .select("auto_price_increase_limit_pct")
    .eq("section_slug", product.category_slug ?? "")
    .limit(1)
    .single();

  const limitPct = sectionConfig?.auto_price_increase_limit_pct
    ? Number(sectionConfig.auto_price_increase_limit_pct)
    : 10;

  // R5.5: reduction always auto-applies
  if (changePct <= 0) {
    return {
      published: true,
      productId: product.id,
      categorySlug: product.category_slug,
      oldPriceCentavos,
      newPriceCentavos,
      changePct,
      limitPct,
      safe: true,
      switchAllowed: true,
    };
  }

  // R5.3/R5.4: increase within limit auto-applies; above limit → price blocked
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
      switchAllowed: true,
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
    switchAllowed: true,
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
    .select("id, master_product_id, supplier_id, cost_centavos, unit_cost_centavos, stock, lead_time_days, status")
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

  // 4. R6 official: select by LOWEST unit cost among eligible with stock > 0
  const unitCost = (o: RankableOffer) => o.unit_cost_centavos ?? o.cost_centavos;
  const eligibleWithStock = offers.filter(
    (o) => (o.stock ?? 0) > 0 && unitCost(o) > 0,
  );

  if (eligibleWithStock.length === 0) {
    return { ...base, action: "pendencia", reason: "sem_fornecedor_com_estoque" };
  }

  eligibleWithStock.sort((a, b) => unitCost(a) - unitCost(b));
  const recommendedOffer = eligibleWithStock[0];

  // Ranking still computed for BI/audit snapshot (NOT used for supplier selection)
  const ranking: ProductRanking | null = rankProductOffers(offers);

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
  if (currentOfferId === recommendedOffer.id) {
    return { ...base, action: "noop", reason: "ja_selecionado" };
  }

  // 7. Check critical exceptions
  const { count: criticalCount } = await sb
    .from("procurement_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("master_product_id", masterProductId)
    .eq("status", "open")
    .eq("severity", "critical");

  if (criticalCount && criticalCount > 0) {
    return { ...base, action: "pendencia", reason: "excecao_critica_aberta" };
  }

  // 10. Simulate pricing impact (pre-check)
  const pricing = await simulatePricingImpact(
    sb,
    masterProductId,
    recommendedOffer.unit_cost_centavos ?? recommendedOffer.cost_centavos,
  );

  // R6.3: if pricing error (no margin, ambiguous) AND switch not allowed → pendencia
  if (!pricing.safe && !pricing.switchAllowed) {
    return {
      ...base,
      action: "pendencia",
      reason: pricing.reason ?? "pricing_inseguro",
      offerId: recommendedOffer.id,
      changePct: pricing.changePct,
    };
  }

  // R6.3: price blocked but switch allowed → proceed, keep old price
  const priceBlocked = !pricing.safe && pricing.switchAllowed;

  // 11. Build ranking snapshot (BI only)
  const snapshot = ranking
    ? ranking.offers.map((o) => ({
        offer_id: o.supplier_offer_id,
        supplier_id: o.supplier_id,
        score: o.score_total,
        position: o.position,
      }))
    : [];

  const isSwitch = currentOfferId != null;
  const notePrefix = isSwitch ? "[auto-switch]" : "[auto-sourcing]";
  const reason = isSwitch
    ? trigger === "ineligible"
      ? "fornecedor_inelegivel"
      : "economy_opportunity"
    : "primeira_selecao";

  const note = priceBlocked
    ? `${notePrefix} ${reason} — menor custo unitário: ${unitCost(recommendedOffer)} centavos — preço bloqueado (${pricing.reason})`
    : `${notePrefix} ${reason} — menor custo unitário: ${unitCost(recommendedOffer)} centavos`;

  // 12. Call transactional RPC
  // R6.3: when price blocked, pass null for new price (keep old price)
  const rpcParams: Record<string, unknown> = {
    p_master_product_id: masterProductId,
    p_new_offer_id: recommendedOffer.id,
    p_note: note,
    p_score: unitCost(recommendedOffer),
    p_ranking_snapshot: snapshot,
    p_reason: reason,
    p_expected_old_offer_id: currentOfferId,
    p_expected_new_cost_centavos: recommendedOffer.cost_centavos,
    p_new_price_centavos: priceBlocked ? null : (pricing.published ? pricing.newPriceCentavos : null),
    p_price_blocked: priceBlocked,
    p_blocked_new_price_centavos: priceBlocked ? pricing.newPriceCentavos : null,
    p_blocked_change_pct: priceBlocked ? pricing.changePct : null,
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
    price_blocked?: boolean;
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

  let pricingAction: AutoSourceResult["pricingAction"];
  if (priceBlocked || result.price_blocked) {
    pricingAction = "price_blocked";
  } else if (result.price_updated) {
    pricingAction = "auto_applied";
  } else if (pricing.published) {
    pricingAction = "no_change";
  } else {
    pricingAction = "not_published";
  }

  // Fase K: auto-promote on price drop (per-supplier, OFF by default)
  if (
    pricingAction === "auto_applied" &&
    pricing.changePct != null &&
    pricing.changePct < 0 &&
    pricing.productId &&
    pricing.oldPriceCentavos
  ) {
    const supplierId = result.new_supplier_id ?? recommendedOffer.supplier_id;
    const autoPromote = await readFlag(sb, "auto_promote", `supplier:${supplierId}`);
    if (autoPromote) {
      const oldRetail = pricing.oldPriceCentavos / 100;
      const { data: prod } = await sb
        .from("products")
        .select("list_price, badges")
        .eq("id", pricing.productId)
        .single();
      if (prod) {
        const badges = Array.from(new Set([...((prod.badges as string[]) ?? []), "oferta"]));
        await sb
          .from("products")
          .update({ list_price: prod.list_price ?? oldRetail, badges })
          .eq("id", pricing.productId);
      }
    }
  }

  return {
    ...base,
    action: result.action === "switched" ? "switched" : "selected",
    reason,
    offerId: recommendedOffer.id,
    supplierId: result.new_supplier_id,
    oldOfferId: currentOfferId ?? undefined,
    oldSupplierId: result.old_supplier_id ?? undefined,
    pricingAction,
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
