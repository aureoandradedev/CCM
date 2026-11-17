/**
 * Pesos e thresholds do matching — configuração centralizada.
 *
 * PESOS (somam até 95 sem EAN):
 *   EAN exato válido           = 50  (sinal dominante — só override)
 *   Marca + Modelo             = 30  (muito forte, detecta modelo no nome)
 *   Nome / tokens canônicos    = 25  (Jaccard + containment)
 *   Chave alfanumérica         = 15  (conteúdo idêntico ignora formatação)
 *   Atributos compatíveis      = 20  (voltagem/peso/potência/volume/cor/medida)
 *   Categoria / subcategoria   =  5  (suporte)
 *
 * EAN OVERRIDE:
 *   EAN válido + único em master_products → score 95 (determinístico).
 *   EAN check digit inválido + único → score 95 SOMENTE SE:
 *     (a) sem hard conflict, E (b) marca bate OU >= 2 tokens de nome em comum.
 *     Senão → scoring normal (revisão humana).
 *
 * HARD CONFLICTS:
 *   Atributos cuja incompatibilidade IMPEDE match_sugerido,
 *   independentemente do score bruto. Forçam revisao_manual.
 *     - voltage: 127V vs 220V (variante elétrica diferente)
 *     - weight_kg: 10kg vs 20kg (produto diferente)
 *     - measure_cm: 30cm vs 40cm (produto fisicamente diferente)
 *     - power_w: 500W vs 750W (modelo diferente)
 *
 * SOFT PENALTIES:
 *   Atributos que penalizam o score mas NÃO bloqueiam match_sugerido.
 *     - color: preto vs branco (pode ser variante cosmética)
 *
 * THRESHOLDS:
 *   >= 75  → match_sugerido   (alta confiança, SEM hard conflict)
 *   >= 45  → revisao_manual   (média confiança — precisa humano)
 *   <  45  → normalizado      (sem match)
 *
 * AMBIGUIDADE:
 *   Se |score_1 - score_2| < MIN_SCORE_GAP → revisao_manual
 *   mesmo que score_1 >= threshold alto.
 */

export const MATCH_WEIGHTS = {
  EAN_EXACT: 50,
  BRAND_MODEL: 30,
  NAME_TOKENS: 25,
  ALPHANUM_KEY: 15,
  ATTRIBUTES: 20,
  CATEGORY: 5,
} as const;

export const EAN_OVERRIDE_SCORE = 95;

export const MATCH_THRESHOLDS = {
  HIGH_CONFIDENCE: 75,
  REVIEW: 40,
} as const;

export const AMBIGUITY_MIN_SCORE = 15;

export const HARD_CONFLICT_ATTRIBUTES = new Set([
  "voltage",
  "weight_kg",
  "measure_cm",
  "power_w",
]);

export const SOFT_PENALTY_ATTRIBUTES: Record<string, number> = {
  color: 8,
};

export const ATTRIBUTE_PENALTIES = {
  VOLTAGE_MISMATCH: 20,
  COLOR_MISMATCH: 8,
  MEASURE_MISMATCH: 15,
  WEIGHT_MISMATCH: 15,
  POWER_MISMATCH: 15,
} as const;

export const MIN_SCORE_GAP = 5;

export const NAME_BINDING_BOOST = 10;

export const STOP_TOKENS = new Set([
  "unidade", "produto", "novo", "caixa", "pacote",
  "com", "para", "sem", "por", "und", "pcs",
]);
