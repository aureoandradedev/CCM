/**
 * Motor de ciclo de compra CCM (Fases 14–16).
 *
 * R4.1: Vendas acumulam por fornecedor, viram pedido no próximo dia de pedido.
 * R4.2: Prazo ao cliente = próximo dia de pedido + prazo_entrega_cd_dias (dias úteis).
 * R4.3: Se total < pedido_minimo no dia do ciclo, pedido não envia + notificação.
 */

const BRAZIL_TZ = "America/Sao_Paulo";

function todayBR(): Date {
  const now = new Date();
  const brStr = now.toLocaleDateString("en-CA", { timeZone: BRAZIL_TZ });
  return new Date(brStr + "T12:00:00");
}

function dayOfWeek(d: Date): number {
  return d.getDay();
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Próximo dia de pedido a partir de `from` (inclusive).
 * dias_pedido: array de int 0-6 (0=dom, 1=seg, ..., 6=sab).
 * Se from já é um dia de pedido e afterCutoff=false, retorna from.
 */
export function nextOrderDay(diasPedido: number[], from: Date, afterCutoff = false): Date | null {
  if (!diasPedido || diasPedido.length === 0) return null;
  const sorted = [...new Set(diasPedido)].sort((a, b) => a - b);
  let d = afterCutoff ? addDays(from, 1) : new Date(from);
  for (let i = 0; i < 8; i++) {
    if (sorted.includes(dayOfWeek(d))) return d;
    d = addDays(d, 1);
  }
  return null;
}

/**
 * Adiciona N dias úteis a uma data (pula sábado, domingo e feriados).
 * R4.2: "feriado não conta como dia útil".
 */
export function addBusinessDays(from: Date, n: number, holidays: string[] = []): Date {
  let d = new Date(from);
  let remaining = n;
  const holidaySet = new Set(holidays);
  while (remaining > 0) {
    d = addDays(d, 1);
    const dow = dayOfWeek(d);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(formatDate(d))) remaining--;
  }
  return d;
}

/**
 * R4.2: Data esperada de disponibilidade no CD para o cliente.
 * = próximo dia de pedido + prazo_entrega_cd_dias (dias úteis).
 *
 * @param diasPedido - dias da semana de pedido do fornecedor (int[])
 * @param prazoEntregaCdDias - dias úteis após o pedido para entrega no CD
 * @param saleDate - data da venda (default: hoje BR)
 * @param afterCutoff - se a venda foi depois do horário de corte do dia
 */
export function calculateExpectedAvailabilityDate(
  diasPedido: number[],
  prazoEntregaCdDias: number,
  saleDate?: Date,
  afterCutoff = false,
  holidays: string[] = [],
): { orderDay: string; availabilityDate: string } | null {
  const from = saleDate ?? todayBR();
  const orderDay = nextOrderDay(diasPedido, from, afterCutoff);
  if (!orderDay) return null;
  const availability = addBusinessDays(orderDay, prazoEntregaCdDias, holidays);
  return {
    orderDay: formatDate(orderDay),
    availabilityDate: formatDate(availability),
  };
}

/**
 * Calcula quantas embalagens comprar e a sobra (R3.4).
 * "Cliente compra 3 un. → CCM compra 1 caixa → 7 un. entram como sobra"
 */
export function calculatePackagePurchase(
  quantityUnits: number,
  qtdPorEmbalagem: number,
  existingLeftover = 0,
): { packagesToBuy: number; totalUnits: number; leftover: number; unitsFromStock: number } {
  const effectiveQty = Math.max(0, quantityUnits - existingLeftover);
  const unitsFromStock = quantityUnits - effectiveQty;

  if (effectiveQty === 0 || qtdPorEmbalagem <= 1) {
    return {
      packagesToBuy: effectiveQty,
      totalUnits: effectiveQty,
      leftover: 0,
      unitsFromStock,
    };
  }

  const packagesToBuy = Math.ceil(effectiveQty / qtdPorEmbalagem);
  const totalUnits = packagesToBuy * qtdPorEmbalagem;
  const leftover = totalUnits - effectiveQty;

  return { packagesToBuy, totalUnits, leftover, unitsFromStock };
}

/**
 * R5.3 / R5.4: Verifica se a mudança de preço está dentro do limite automático.
 * R5.5: Redução de preço muda sempre sozinha.
 */
export function checkPriceChangeLimit(
  oldPriceCentavos: number,
  newPriceCentavos: number,
  limitPct: number | null,
): { allowed: boolean; changePct: number; isReduction: boolean } {
  if (oldPriceCentavos <= 0) return { allowed: true, changePct: 0, isReduction: false };

  const changePct = ((newPriceCentavos - oldPriceCentavos) / oldPriceCentavos) * 100;
  const isReduction = newPriceCentavos <= oldPriceCentavos;

  if (isReduction) return { allowed: true, changePct, isReduction };

  if (limitPct === null || limitPct === undefined) return { allowed: true, changePct, isReduction };

  const allowed = changePct <= limitPct;
  return { allowed, changePct, isReduction };
}

/**
 * R3.2: Calcula preço da caixa no modo unidade_e_caixa.
 * "Caixa com 10 — R$ 89,10 (10% off)" = unit_price × qty × (1 - discount/100)
 */
export function calculateBoxPrice(
  unitPrice: number,
  qty: number,
  discountPct: number,
): number {
  const fullPrice = unitPrice * qty;
  return Math.round(fullPrice * (1 - discountPct / 100) * 100) / 100;
}

export const WEEKDAY_LABELS_PT: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

export const WEEKDAY_SHORT_PT: Record<number, string> = {
  0: "Dom",
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
};
