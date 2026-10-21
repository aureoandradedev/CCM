/**
 * Pesos, thresholds e parâmetros do ranking — configuração centralizada.
 *
 * PESOS (somam 100):
 *   custo       = 60  (prioridade dominante)
 *   estoque     = 20  (disponibilidade)
 *   prazo       = 20  (agilidade de entrega)
 *
 * SCORE:
 *   Relativo entre ofertas do mesmo master_product.
 *   0 a 100.
 *
 * CUSTO:
 *   score_cost = (min_cost / cost) × 100
 *   cost <= 0 → oferta inválida (flag missing_cost, score 0)
 *
 * ESTOQUE:
 *   Saturação logarítmica: log(1+stock) / log(1+SATURATION) × 100
 *   stock = 0 ou null → score 0, flag out_of_stock
 *   stock < LOW_STOCK_THRESHOLD → flag low_stock
 *
 * PRAZO:
 *   Somente ofertas com lead_time_days válido (>= 0, não null) participam
 *   da normalização relativa.
 *   score_lead = (min_effective / effective) × 100, effective = lead + 1
 *   lead null ou negativo → score_lead = 0, flag missing_lead_time
 *   Se TODAS as ofertas têm prazo inválido → todas recebem score_lead = 0.
 *
 * OUTLIER:
 *   cost > median × PRICE_OUTLIER_FACTOR → flag price_outlier
 *
 * AMBIGUIDADE:
 *   Calculada entre as duas melhores ofertas RECOMENDÁVEIS
 *   (exclui out_of_stock e missing_cost).
 *   |score_1 - score_2| < MIN_RANK_GAP → ambiguous_rank, sem recomendação
 *
 * ELEGIBILIDADE:
 *   ativa → elegível para ranking competitivo
 *   escolhida → legado, não utilizado (seleção em sourcing_selections)
 *   indisponivel → não elegível
 *   vencida → não elegível
 */

export const RANK_WEIGHTS = {
  COST: 60,
  STOCK: 20,
  LEAD_TIME: 20,
} as const;

export const ELIGIBLE_STATUSES = new Set(["ativa"]);

export const STOCK_SATURATION = 500;
export const LOW_STOCK_THRESHOLD = 5;
export const PRICE_OUTLIER_FACTOR = 3;
export const MIN_RANK_GAP = 3;
