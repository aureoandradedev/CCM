/**
 * Regras de preço do CCM: varejo x atacado (modelo Obramax/Multigiro Atacadão),
 * desconto no Pix e parcelamento. Tudo puro, sem dependência de UI, para ser
 * usado igual no card, na gaveta do carrinho e no checkout.
 */

export const DEFAULT_PIX_DISCOUNT_PCT = 5;
export const MAX_INSTALLMENTS = 10;
export const MIN_INSTALLMENT_VALUE = 50;
export const MAX_QTY_PER_LINE = 9999;

export interface PriceLike {
  retailPrice: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  listPrice?: number;
  pixDiscountPct?: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function hasWholesale(p: PriceLike): boolean {
  return (
    typeof p.wholesalePrice === "number" &&
    p.wholesalePrice > 0 &&
    (p.wholesaleMinQty ?? 0) > 1 &&
    p.wholesalePrice < p.retailPrice
  );
}

export function isWholesaleActive(p: PriceLike, qty: number): boolean {
  return hasWholesale(p) && qty >= (p.wholesaleMinQty as number);
}

/** Preço unitário que vale para a quantidade escolhida. */
export function unitPriceFor(p: PriceLike, qty: number): number {
  return isWholesaleActive(p, qty) ? (p.wholesalePrice as number) : p.retailPrice;
}

export function lineTotal(p: PriceLike, qty: number): number {
  return round2(unitPriceFor(p, qty) * qty);
}

/** Quantas unidades faltam para destravar o atacado (0 se já destravou ou não existe). */
export function unitsToWholesale(p: PriceLike, qty: number): number {
  if (!hasWholesale(p) || isWholesaleActive(p, qty)) return 0;
  return (p.wholesaleMinQty as number) - qty;
}

/** Economia percentual do atacado sobre o varejo. */
export function wholesaleSavingsPct(p: PriceLike): number {
  if (!hasWholesale(p)) return 0;
  return Math.round((1 - (p.wholesalePrice as number) / p.retailPrice) * 100);
}

/** Desconto da oferta (preço "de" riscado). */
export function offerDiscountPct(p: PriceLike): number {
  if (!p.listPrice || p.listPrice <= p.retailPrice) return 0;
  return Math.round((1 - p.retailPrice / p.listPrice) * 100);
}

export function pixPrice(price: number, pct: number = DEFAULT_PIX_DISCOUNT_PCT): number {
  return round2(price * (1 - pct / 100));
}

export interface InstallmentPlan {
  count: number;
  value: number;
}

/** Parcelamento sem juros: até 10x, parcela mínima de R$ 50. */
export function installmentPlan(
  total: number,
  opts: { max?: number; min?: number } = {},
): InstallmentPlan {
  const max = opts.max ?? MAX_INSTALLMENTS;
  const min = opts.min ?? MIN_INSTALLMENT_VALUE;
  const count = Math.max(1, Math.min(max, Math.floor(total / min)));
  return { count, value: round2(total / count) };
}

export interface CartLineLike extends PriceLike {
  qty: number;
}

export interface CartTotals {
  count: number;
  subtotal: number;
  retailSubtotal: number;
  wholesaleSavings: number;
  pixTotal: number;
  pixSavings: number;
}

export function computeCartTotals(lines: CartLineLike[]): CartTotals {
  let subtotal = 0;
  let retailSubtotal = 0;
  let count = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(line.qty));
    if (!qty) continue;
    subtotal += unitPriceFor(line, qty) * qty;
    retailSubtotal += line.retailPrice * qty;
    count += qty;
  }
  subtotal = round2(subtotal);
  retailSubtotal = round2(retailSubtotal);
  const pixTotal = pixPrice(subtotal);
  return {
    count,
    subtotal,
    retailSubtotal,
    wholesaleSavings: round2(retailSubtotal - subtotal),
    pixTotal,
    pixSavings: round2(subtotal - pixTotal),
  };
}
