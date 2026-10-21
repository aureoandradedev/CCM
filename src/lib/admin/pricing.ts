/**
 * Margem e precificação CCM (Fase 7).
 *
 * Semântica: margin_pct é MARKUP sobre o custo.
 *   preço = custo × (1 + margin_pct / 100)
 *
 * Exemplo: custo R$ 100, margem 30% → preço R$ 130,00.
 *
 * Arredondamento:
 *   'none'  → sem arredondamento (centavos exatos)
 *   'X90'   → último dígito dos centavos = 90 (R$ 129,90)
 *   'X99'   → último dígito dos centavos = 99 (R$ 129,99)
 *
 * Após arredondamento, garante que preço >= custo e preço >= min_price_centavos.
 */

export interface MarginRule {
  id: string;
  scope: "global" | "category" | "product";
  scope_ref: string | null;
  margin_pct: number;
  min_price_centavos: number | null;
  rounding: "none" | "X90" | "X99";
  priority: number;
  active: boolean;
}

export interface ResolvedMargin {
  rule: MarginRule;
  source: string;
}

export interface AmbiguousMargin {
  tied: MarginRule[];
  source: string;
}

export type MarginResult =
  | { ok: true; rule: MarginRule; source: string }
  | { ok: false; tied: MarginRule[]; source: string }
  | null;

function resolveScope(
  candidates: MarginRule[],
  source: string,
): MarginResult {
  if (candidates.length === 0) return null;
  const sorted = candidates.sort((a, b) => b.priority - a.priority);
  const topPriority = sorted[0].priority;
  const tied = sorted.filter((r) => r.priority === topPriority);
  if (tied.length > 1) return { ok: false, tied, source };
  return { ok: true, rule: sorted[0], source };
}

export function resolveMargin(
  rules: MarginRule[],
  masterProductId: string,
  categorySlug: string | null,
): MarginResult {
  const active = rules.filter((r) => r.active);

  const byProduct = active.filter((r) => r.scope === "product" && r.scope_ref === masterProductId);
  const productResult = resolveScope(byProduct, `produto (${masterProductId})`);
  if (productResult) return productResult;

  if (categorySlug) {
    const byCategory = active.filter((r) => r.scope === "category" && r.scope_ref === categorySlug);
    const categoryResult = resolveScope(byCategory, `categoria (${categorySlug})`);
    if (categoryResult) return categoryResult;
  }

  const global = active.filter((r) => r.scope === "global");
  return resolveScope(global, "global");
}

export interface PriceCalculation {
  cost_centavos: number;
  margin_pct: number;
  raw_price_centavos: number;
  rounded_price_centavos: number;
  retail_price: number;
  rounding: "none" | "X90" | "X99";
  min_price_centavos: number | null;
  margin_rule_id: string;
  source: string;
}

export function calculatePrice(
  cost_centavos: number,
  resolved: ResolvedMargin,
): PriceCalculation {
  const { rule, source } = resolved;
  const margin_pct = Number(rule.margin_pct);

  const raw = Math.round(cost_centavos * (1 + margin_pct / 100));

  let rounded = raw;
  if (rule.rounding === "X90") {
    rounded = Math.floor(raw / 100) * 100 + 90;
    if (rounded < raw) rounded += 100;
  } else if (rule.rounding === "X99") {
    rounded = Math.floor(raw / 100) * 100 + 99;
    if (rounded < raw) rounded += 100;
  }

  if (rounded < cost_centavos) rounded = cost_centavos;
  if (rule.min_price_centavos != null && rounded < rule.min_price_centavos) {
    rounded = rule.min_price_centavos;
  }

  return {
    cost_centavos,
    margin_pct,
    raw_price_centavos: raw,
    rounded_price_centavos: rounded,
    retail_price: rounded / 100,
    rounding: rule.rounding,
    min_price_centavos: rule.min_price_centavos,
    margin_rule_id: rule.id,
    source,
  };
}
