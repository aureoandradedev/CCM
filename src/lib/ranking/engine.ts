import {
  RANK_WEIGHTS,
  ELIGIBLE_STATUSES,
  STOCK_SATURATION,
  LOW_STOCK_THRESHOLD,
  PRICE_OUTLIER_FACTOR,
  MIN_RANK_GAP,
} from "./config";
import type {
  RankableOffer,
  RankedOffer,
  ProductRanking,
  RankFlag,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasValidLead(o: RankableOffer): boolean {
  return o.lead_time_days != null && o.lead_time_days >= 0;
}

function scoreStock(stock: number | null): number {
  const s = stock == null ? 0 : Math.max(stock, 0);
  if (s === 0) return 0;
  return Math.min(
    100,
    (Math.log(1 + s) / Math.log(1 + STOCK_SATURATION)) * 100,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatPct(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function pluralDias(n: number): string {
  return n === 1 ? "1 dia" : `${n} dias`;
}

function isRecommendable(o: RankedOffer): boolean {
  return (
    !o.flags.includes("out_of_stock") &&
    !o.flags.includes("missing_cost")
  );
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function rankProductOffers(
  offers: RankableOffer[],
): ProductRanking | null {
  if (offers.length === 0) return null;

  const masterProductId = offers[0].master_product_id;

  // ── Filtrar elegíveis (somente ativa) ──────────────────────────────────
  const eligible = offers.filter((o) => ELIGIBLE_STATUSES.has(o.status));
  if (eligible.length === 0) {
    return {
      master_product_id: masterProductId,
      recommended_offer_id: null,
      ambiguous: false,
      offers: [],
    };
  }

  const valid = eligible.filter((o) => o.cost_centavos > 0);
  const invalid = eligible.filter((o) => o.cost_centavos <= 0);

  // ── Valores de referência (apenas ofertas válidas) ─────────────────────

  const costs = valid.map((o) => o.cost_centavos);
  const minCost = costs.length > 0 ? Math.min(...costs) : 0;
  const medCost = median(costs);

  // Prazo: somente ofertas com lead válido participam da normalização
  const validLeadOffers = valid.filter(hasValidLead);
  const effectiveLeads = validLeadOffers.map(
    (o) => o.lead_time_days + 1,
  );
  const minEffLead =
    effectiveLeads.length > 0 ? Math.min(...effectiveLeads) : 0;

  // ── Melhores em cada dimensão (para reasons) ──────────────────────────

  let bestCostOffer: RankableOffer | null = null;
  let bestLeadOffer: RankableOffer | null = null;
  let bestStockOffer: RankableOffer | null = null;

  for (const o of valid) {
    if (
      !bestCostOffer ||
      o.cost_centavos < bestCostOffer.cost_centavos
    ) {
      bestCostOffer = o;
    }
    if (
      hasValidLead(o) &&
      (!bestLeadOffer ||
        o.lead_time_days < bestLeadOffer.lead_time_days)
    ) {
      bestLeadOffer = o;
    }
    if (
      !bestStockOffer ||
      (o.stock ?? 0) > (bestStockOffer.stock ?? 0)
    ) {
      bestStockOffer = o;
    }
  }

  // ── Scoring de ofertas válidas ─────────────────────────────────────────

  const scored: RankedOffer[] = valid.map((o) => {
    const flags: RankFlag[] = [];
    const stock = o.stock ?? 0;

    if (stock === 0 || o.stock == null) flags.push("out_of_stock");
    else if (stock < LOW_STOCK_THRESHOLD) flags.push("low_stock");

    if (!hasValidLead(o)) {
      flags.push("missing_lead_time");
    }

    if (
      medCost > 0 &&
      o.cost_centavos > medCost * PRICE_OUTLIER_FACTOR
    ) {
      flags.push("price_outlier");
    }

    const sCost = minCost > 0 ? (minCost / o.cost_centavos) * 100 : 0;
    const sStock = scoreStock(o.stock);

    // Prazo: score 0 se lead inválido; relativo se válido
    let sLead = 0;
    if (hasValidLead(o) && minEffLead > 0) {
      sLead = (minEffLead / (o.lead_time_days + 1)) * 100;
    }

    const total =
      (RANK_WEIGHTS.COST * sCost +
        RANK_WEIGHTS.STOCK * sStock +
        RANK_WEIGHTS.LEAD_TIME * sLead) /
      100;

    // ── Reasons ──────────────────────────────────────────────────────────

    const reasons: string[] = [];

    if (
      bestCostOffer &&
      o.cost_centavos === bestCostOffer.cost_centavos
    ) {
      reasons.push("menor custo");
    }

    if (
      hasValidLead(o) &&
      bestLeadOffer &&
      o.lead_time_days === bestLeadOffer.lead_time_days
    ) {
      reasons.push("prazo mais curto");
    }

    if (
      bestStockOffer &&
      (o.stock ?? 0) === (bestStockOffer.stock ?? 0) &&
      (o.stock ?? 0) > 0
    ) {
      reasons.push("maior estoque");
    }

    if (
      stock >= LOW_STOCK_THRESHOLD &&
      bestStockOffer &&
      (o.stock ?? 0) < (bestStockOffer.stock ?? 0)
    ) {
      reasons.push("estoque adequado");
    }

    if (
      bestCostOffer &&
      o.cost_centavos > bestCostOffer.cost_centavos &&
      bestCostOffer.cost_centavos > 0
    ) {
      const pct =
        ((o.cost_centavos - bestCostOffer.cost_centavos) /
          bestCostOffer.cost_centavos) *
        100;
      const cheapestLead = Math.max(
        bestCostOffer.lead_time_days ?? 0,
        0,
      );
      const thisLead = Math.max(o.lead_time_days ?? 0, 0);

      if (hasValidLead(o) && thisLead < cheapestLead) {
        reasons.push(
          `custo ${formatPct(pct)}% maior que o menor, mas entrega ${pluralDias(cheapestLead - thisLead)} mais rápida`,
        );
      } else {
        reasons.push(`custo ${formatPct(pct)}% acima do menor`);
      }
    }

    return {
      supplier_offer_id: o.id,
      supplier_id: o.supplier_id,
      position: 0,
      score_total: round2(total),
      score_cost: round2(sCost),
      score_stock: round2(sStock),
      score_lead_time: round2(sLead),
      reasons,
      flags,
    };
  });

  // ── Ofertas inválidas (cost <= 0) ──────────────────────────────────────

  for (const o of invalid) {
    scored.push({
      supplier_offer_id: o.id,
      supplier_id: o.supplier_id,
      position: 0,
      score_total: 0,
      score_cost: 0,
      score_stock: 0,
      score_lead_time: 0,
      reasons: [],
      flags: ["missing_cost"],
    });
  }

  // ── Ordenação: score desc, custo asc como desempate ────────────────────

  scored.sort((a, b) => {
    if (b.score_total !== a.score_total) return b.score_total - a.score_total;
    return b.score_cost - a.score_cost;
  });

  scored.forEach((o, i) => {
    o.position = i + 1;
  });

  // ── Ambiguidade (entre as 2 melhores RECOMENDÁVEIS) ────────────────────

  const recommendable = scored.filter(isRecommendable);

  const ambiguous =
    recommendable.length >= 2 &&
    Math.abs(
      recommendable[0].score_total - recommendable[1].score_total,
    ) < MIN_RANK_GAP;

  if (ambiguous) {
    if (!recommendable[0].flags.includes("ambiguous_rank"))
      recommendable[0].flags.push("ambiguous_rank");
    if (!recommendable[1].flags.includes("ambiguous_rank"))
      recommendable[1].flags.push("ambiguous_rank");
  }

  // ── Recomendação ───────────────────────────────────────────────────────

  let recommended: string | null = null;
  if (!ambiguous && recommendable.length > 0) {
    recommended = recommendable[0].supplier_offer_id;
  }

  return {
    master_product_id: masterProductId,
    recommended_offer_id: recommended,
    ambiguous,
    offers: scored,
  };
}

export function rankAllProducts(
  offers: RankableOffer[],
): ProductRanking[] {
  const grouped = new Map<string, RankableOffer[]>();
  for (const o of offers) {
    const group = grouped.get(o.master_product_id);
    if (group) group.push(o);
    else grouped.set(o.master_product_id, [o]);
  }

  const results: ProductRanking[] = [];
  for (const [, group] of grouped) {
    const ranking = rankProductOffers(group);
    if (ranking) results.push(ranking);
  }

  return results;
}
