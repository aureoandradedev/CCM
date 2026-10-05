/**
 * Regras de preço no servidor — espelho de src/lib/pricing.ts (varejo x atacado,
 * Pix). Tudo em CENTAVOS inteiros: o servidor é a fonte oficial dos totais.
 */

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const centavos = (reais) => Math.round(Number(reais) * 100);

export function temAtacado(p) {
  const w = Number(p.wholesale_price ?? p.wholesalePrice);
  const min = Number(p.wholesale_min_qty ?? p.wholesaleMinQty);
  const r = Number(p.retail_price ?? p.retailPrice);
  return Number.isFinite(w) && w > 0 && Number.isFinite(min) && min > 1 && w < r;
}

export function atacadoAtivo(p, qty) {
  return temAtacado(p) && Number(qty) >= Number(p.wholesale_min_qty ?? p.wholesaleMinQty);
}

/** Preço unitário (centavos) que vale para a quantidade. */
export function precoUnitarioCentavos(p, qty) {
  return atacadoAtivo(p, qty) ? centavos(p.wholesale_price ?? p.wholesalePrice) : centavos(p.retail_price ?? p.retailPrice);
}

/** Frete a partir de site_settings.frete. Regra simples: grátis acima de X, senão tarifa fixa. */
export function calcularFrete({ deliveryMethod, subtotalCentavos, frete }) {
  const cfg = frete || {};
  if (deliveryMethod === "pickup") return { freightCentavos: 0, rule: "pickup" };
  const free = Number(cfg.freeShippingFromCentavos ?? 79900);
  const flat = Number(cfg.flatCentavos ?? 4990);
  if (subtotalCentavos >= free) return { freightCentavos: 0, rule: "free-shipping" };
  return { freightCentavos: flat, rule: "flat" };
}

/** Desconto Pix (site_settings.descontos.pixPct) sobre o subtotal líquido. */
export function descontoPixCentavos(subtotalCentavos, descontos) {
  const pct = Number(descontos?.pixPct ?? 5);
  if (!(pct > 0)) return 0;
  return Math.round((subtotalCentavos * pct) / 100);
}

export function metodoEhPix(m) {
  return m === "pix";
}
export function metodoEhCartaoOnline(m) {
  return m === "cartao-pendente" || m === "cartao-credito" || m === "cartao-debito";
}
export function metodoOnline(m) {
  return metodoEhPix(m) || metodoEhCartaoOnline(m);
}
