/**
 * Ranking engine — backend port of src/lib/ranking/engine.ts
 *
 * Pure functions, no external dependencies. Decides winner (position 1)
 * and backup (position 2) per master_product based on supplier offers.
 *
 * Rule R6.1: lowest unit_cost_centavos among eligible with stock > 0.
 * Ambiguous = same unit_cost between top 2 → no recommendation.
 */

const RANK_WEIGHTS = { COST: 60, STOCK: 20, LEAD_TIME: 20 };
const ELIGIBLE_STATUSES = new Set(["ativa"]);
const STOCK_SATURATION = 500;
const LOW_STOCK_THRESHOLD = 5;
const PRICE_OUTLIER_FACTOR = 3;
const MIN_RANK_GAP = 3;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasValidLead(o) {
  return o.lead_time_days != null && o.lead_time_days >= 0;
}

function scoreStock(stock) {
  const s = stock == null ? 0 : Math.max(stock, 0);
  if (s === 0) return 0;
  return Math.min(100, (Math.log(1 + s) / Math.log(1 + STOCK_SATURATION)) * 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isRecommendable(o) {
  return !o.flags.includes("out_of_stock") && !o.flags.includes("missing_cost");
}

/**
 * @param {Array<{id:string, master_product_id:string, supplier_id:string, cost_centavos:number, unit_cost_centavos?:number, stock:number|null, lead_time_days:number, status:string}>} offers
 * @returns {{master_product_id:string, recommended_offer_id:string|null, ambiguous:boolean, offers:Array}|null}
 */
export function rankProductOffers(offers) {
  if (offers.length === 0) return null;
  const masterProductId = offers[0].master_product_id;

  const eligible = offers.filter((o) => ELIGIBLE_STATUSES.has(o.status));
  if (eligible.length === 0) {
    return { master_product_id: masterProductId, recommended_offer_id: null, ambiguous: false, offers: [] };
  }

  const valid = eligible.filter((o) => o.cost_centavos > 0);
  const invalid = eligible.filter((o) => o.cost_centavos <= 0);

  const costs = valid.map((o) => o.cost_centavos);
  const minCost = costs.length > 0 ? Math.min(...costs) : 0;
  const medCost = median(costs);

  const validLeadOffers = valid.filter(hasValidLead);
  const effectiveLeads = validLeadOffers.map((o) => o.lead_time_days + 1);
  const minEffLead = effectiveLeads.length > 0 ? Math.min(...effectiveLeads) : 0;

  const scored = valid.map((o) => {
    const flags = [];
    const stock = o.stock ?? 0;

    if (stock === 0 || o.stock == null) flags.push("out_of_stock");
    else if (stock < LOW_STOCK_THRESHOLD) flags.push("low_stock");

    if (!hasValidLead(o)) flags.push("missing_lead_time");
    if (medCost > 0 && o.cost_centavos > medCost * PRICE_OUTLIER_FACTOR) flags.push("price_outlier");

    const sCost = minCost > 0 ? (minCost / o.cost_centavos) * 100 : 0;
    const sStock = scoreStock(o.stock);
    let sLead = 0;
    if (hasValidLead(o) && minEffLead > 0) {
      sLead = (minEffLead / (o.lead_time_days + 1)) * 100;
    }

    const total = (RANK_WEIGHTS.COST * sCost + RANK_WEIGHTS.STOCK * sStock + RANK_WEIGHTS.LEAD_TIME * sLead) / 100;

    return {
      supplier_offer_id: o.id,
      supplier_id: o.supplier_id,
      position: 0,
      score_total: round2(total),
      score_cost: round2(sCost),
      score_stock: round2(sStock),
      score_lead_time: round2(sLead),
      flags,
    };
  });

  for (const o of invalid) {
    scored.push({
      supplier_offer_id: o.id,
      supplier_id: o.supplier_id,
      position: 0,
      score_total: 0,
      score_cost: 0,
      score_stock: 0,
      score_lead_time: 0,
      flags: ["missing_cost"],
    });
  }

  scored.sort((a, b) => {
    if (b.score_total !== a.score_total) return b.score_total - a.score_total;
    return b.score_cost - a.score_cost;
  });
  scored.forEach((o, i) => { o.position = i + 1; });

  const recommendable = scored.filter(isRecommendable);
  const scoreAmbiguous =
    recommendable.length >= 2 &&
    Math.abs(recommendable[0].score_total - recommendable[1].score_total) < MIN_RANK_GAP;

  if (scoreAmbiguous) {
    if (!recommendable[0].flags.includes("ambiguous_rank")) recommendable[0].flags.push("ambiguous_rank");
    if (!recommendable[1].flags.includes("ambiguous_rank")) recommendable[1].flags.push("ambiguous_rank");
  }

  // R6.1: lowest unit_cost among eligible with stock > 0
  const withStock = eligible
    .filter((o) => (o.stock ?? 0) > 0 && o.cost_centavos > 0)
    .sort((a, b) => {
      const unitA = a.unit_cost_centavos ?? a.cost_centavos;
      const unitB = b.unit_cost_centavos ?? b.cost_centavos;
      return unitA - unitB;
    });

  let recommended = null;
  let ambiguous = false;

  if (withStock.length >= 2) {
    const unitFirst = withStock[0].unit_cost_centavos ?? withStock[0].cost_centavos;
    const unitSecond = withStock[1].unit_cost_centavos ?? withStock[1].cost_centavos;
    ambiguous = unitFirst === unitSecond;
  }

  if (!ambiguous && withStock.length > 0) {
    recommended = withStock[0].id;
  }

  return { master_product_id: masterProductId, recommended_offer_id: recommended, ambiguous, offers: scored };
}

/**
 * Rank all products from a flat list of offers, grouped by master_product_id.
 * @param {Array} offers
 * @returns {Array<{master_product_id, recommended_offer_id, ambiguous, offers}>}
 */
export function rankAllProducts(offers) {
  const grouped = new Map();
  for (const o of offers) {
    const group = grouped.get(o.master_product_id);
    if (group) group.push(o);
    else grouped.set(o.master_product_id, [o]);
  }
  const results = [];
  for (const [, group] of grouped) {
    const ranking = rankProductOffers(group);
    if (ranking) results.push(ranking);
  }
  return results;
}

/**
 * From a ProductRanking, extract winner and backup supplier info.
 * Winner = supplier of recommended offer (position 1 among recommendable with stock).
 * Backup = second supplier with stock (position 2 in R6.1 ordering).
 *
 * @param {object} ranking - ProductRanking from rankProductOffers
 * @param {Array} originalOffers - the original RankableOffer[] for this product
 * @returns {{winner: {supplier_id, offer_id, score}|null, backup: {supplier_id, offer_id, score}|null}}
 */
export function extractWinnerBackup(ranking, originalOffers) {
  if (!ranking || ranking.ambiguous) return { winner: null, backup: null };

  const withStock = originalOffers
    .filter((o) => (o.stock ?? 0) > 0 && o.cost_centavos > 0 && o.status === "ativa")
    .sort((a, b) => {
      const unitA = a.unit_cost_centavos ?? a.cost_centavos;
      const unitB = b.unit_cost_centavos ?? b.cost_centavos;
      return unitA - unitB;
    });

  const rankedMap = new Map(ranking.offers.map((o) => [o.supplier_offer_id, o]));

  let winner = null;
  let backup = null;

  if (withStock.length >= 1) {
    const w = withStock[0];
    const ranked = rankedMap.get(w.id);
    winner = { supplier_id: w.supplier_id, offer_id: w.id, score: ranked?.score_total ?? 0 };
  }

  if (withStock.length >= 2) {
    const b = withStock[1];
    const ranked = rankedMap.get(b.id);
    backup = { supplier_id: b.supplier_id, offer_id: b.id, score: ranked?.score_total ?? 0 };
  }

  return { winner, backup };
}
