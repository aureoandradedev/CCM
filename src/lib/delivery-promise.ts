/**
 * Cálculo de promessa de entrega e agrupamento de shipments.
 *
 * DUAS camadas:
 *   1. Estimativa (frontend) — computeItemEstimate() — para preview em product/cart/checkout
 *   2. Promise (backend)     — computeItemPromise()  — autoritativa, grava snapshot no pedido
 *
 * Funções puras. Reutilizam addBusinessDays de purchase-cycle.ts.
 */

import { addBusinessDays } from "./purchase-cycle";

// ─── Config ────────────────────────────────────────────────────────────────

export const TRANSIT_DAYS_MIN = 1;
export const TRANSIT_DAYS_MAX = 3;

/**
 * Tolerância de agrupamento em DIAS ÚTEIS.
 * Itens cujo deliveryTo difere por ≤ 2 dias úteis ficam no mesmo shipment.
 * Ex: sexta → segunda = 1 dia útil (mesmo grupo); sexta → quarta = 3 (grupo novo).
 */
export const GROUPING_TOLERANCE_BUSINESS_DAYS = 2;

// ─── Types ─────────────────────────────────────────────────────────────────

export type PromiseSource = "precomputed" | "ccm_stock" | "unknown";

export interface DeliveryPromise {
  availableFrom: string;
  deliveryFrom: string;
  deliveryTo: string;
  promisable: true;
  source: PromiseSource;
}

export interface UnpromisableResult {
  availableFrom: null;
  deliveryFrom: null;
  deliveryTo: null;
  promisable: false;
  source: "unknown";
}

export type ItemPromiseResult = DeliveryPromise | UnpromisableResult;

export interface ItemWithPromise<T = unknown> {
  item: T;
  promise: ItemPromiseResult;
}

export interface ShipmentGroup<T = unknown> {
  sequence: number;
  items: ItemWithPromise<T>[];
  promisedFrom: string;
  promisedTo: string;
  availableFrom: string;
  promisable: true;
}

export interface UnpromisableGroup<T = unknown> {
  sequence: number;
  items: ItemWithPromise<T>[];
  promisable: false;
}

export type DeliveryGroup<T = unknown> = ShipmentGroup<T> | UnpromisableGroup<T>;

// ─── Date helpers ──────────────────────────────────────────────────────────

function todayISO(): string {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parseDate(iso: string): Date {
  return new Date(iso + "T12:00:00");
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Conta dias úteis entre duas datas (exclusive de `from`, inclusive de `to`).
 * Reutiliza a mesma lógica de weekends/feriados de addBusinessDays.
 * Ex: sexta→segunda = 1; segunda→terça = 1; sexta→quarta = 3.
 */
export function businessDaysBetween(fromISO: string, toISO: string, holidays: string[] = []): number {
  const from = parseDate(fromISO);
  const to = parseDate(toISO);
  if (to <= from) return 0;

  const holidaySet = new Set(holidays);
  let count = 0;
  let d = new Date(from);
  while (d < to) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !holidaySet.has(formatDate(d))) {
      count++;
    }
  }
  return count;
}

// ─── Promise calculation ───────────────────────────────────────────────────

export interface PromiseInput {
  expectedAvailabilityDate?: string | null;
  stock?: number | null;
}

export interface PromiseConfig {
  transitDaysMin?: number;
  transitDaysMax?: number;
  holidays?: string[];
  today?: string;
}

/**
 * Calcula a promessa de entrega para UM item.
 * Usado tanto no frontend (estimativa) quanto no backend (autoritativa).
 *
 * Regras:
 * 1. Se tem expected_availability_date (futura ou hoje) → usar como availableFrom
 * 2. Se tem stock > 0 (estoque CCM) → availableFrom = hoje
 * 3. Senão → promisable = false (NÃO inventar prazo)
 *
 * Se promisable:
 *   deliveryFrom = addBusinessDays(availableFrom, transitDaysMin)
 *   deliveryTo   = addBusinessDays(availableFrom, transitDaysMax)
 */
export function computeItemPromise(
  input: PromiseInput,
  config: PromiseConfig = {},
): ItemPromiseResult {
  const today = config.today ?? todayISO();
  const minTransit = config.transitDaysMin ?? TRANSIT_DAYS_MIN;
  const maxTransit = config.transitDaysMax ?? TRANSIT_DAYS_MAX;
  const holidays = config.holidays ?? [];

  let availableFrom: string | null = null;
  let source: PromiseSource = "unknown";

  if (input.expectedAvailabilityDate && input.expectedAvailabilityDate >= today) {
    availableFrom = input.expectedAvailabilityDate;
    source = "precomputed";
  } else if (input.stock != null && input.stock > 0) {
    availableFrom = today;
    source = "ccm_stock";
  }

  if (!availableFrom) {
    return { availableFrom: null, deliveryFrom: null, deliveryTo: null, promisable: false, source: "unknown" };
  }

  const avDate = parseDate(availableFrom);
  const deliveryFrom = formatDate(addBusinessDays(avDate, minTransit, holidays));
  const deliveryTo = formatDate(addBusinessDays(avDate, maxTransit, holidays));

  return { availableFrom, deliveryFrom, deliveryTo, promisable: true, source };
}

/**
 * Frontend-friendly wrapper: calcula estimativa a partir dos dados do Product.
 * Retorna o mesmo tipo que computeItemPromise.
 */
export function computeItemEstimate(product: {
  expectedAvailabilityDate?: string;
  stockStatus?: string;
}, config?: PromiseConfig): ItemPromiseResult {
  return computeItemPromise({
    expectedAvailabilityDate: product.expectedAvailabilityDate ?? null,
    stock: product.stockStatus === "in_stock" ? 1 : null,
  }, config);
}

// ─── Grouping ──────────────────────────────────────────────────────────────

/**
 * Agrupa itens por promessa de entrega.
 *
 * Regra de tolerância (DIAS ÚTEIS):
 *   Percorre itens ordenados por deliveryTo ascendente.
 *   Inicia novo grupo quando businessDaysBetween(grupo.firstDeliveryTo, item.deliveryTo) > tolerância.
 *
 * Itens não-promisáveis formam um único grupo "Prazo a confirmar".
 * Não usa supplier_id como chave.
 */
export function groupItemsByPromise<T>(
  itemsWithPromise: ItemWithPromise<T>[],
  config?: { toleranceBusinessDays?: number; holidays?: string[] },
): DeliveryGroup<T>[] {
  const tolerance = config?.toleranceBusinessDays ?? GROUPING_TOLERANCE_BUSINESS_DAYS;
  const holidays = config?.holidays ?? [];

  const promisable = itemsWithPromise.filter((i) => i.promise.promisable);
  const unpromisable = itemsWithPromise.filter((i) => !i.promise.promisable);

  // Sort promisable by deliveryTo ascending, then by item name stability
  const sorted = [...promisable].sort((a, b) => {
    const pa = a.promise as DeliveryPromise;
    const pb = b.promise as DeliveryPromise;
    return pa.deliveryTo.localeCompare(pb.deliveryTo);
  });

  const groups: ShipmentGroup<T>[] = [];
  let currentGroup: ItemWithPromise<T>[] = [];
  let groupFirstDeliveryTo: string | null = null;

  for (const entry of sorted) {
    const p = entry.promise as DeliveryPromise;

    if (groupFirstDeliveryTo === null) {
      currentGroup = [entry];
      groupFirstDeliveryTo = p.deliveryTo;
      continue;
    }

    const diff = businessDaysBetween(groupFirstDeliveryTo, p.deliveryTo, holidays);
    if (diff <= tolerance) {
      currentGroup.push(entry);
    } else {
      groups.push(buildShipmentGroup(currentGroup, groups.length + 1));
      currentGroup = [entry];
      groupFirstDeliveryTo = p.deliveryTo;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(buildShipmentGroup(currentGroup, groups.length + 1));
  }

  const result: DeliveryGroup<T>[] = [...groups];

  if (unpromisable.length > 0) {
    result.push({
      sequence: result.length + 1,
      items: unpromisable,
      promisable: false,
    });
  }

  return result;
}

function buildShipmentGroup<T>(items: ItemWithPromise<T>[], sequence: number): ShipmentGroup<T> {
  let minFrom = "9999-12-31";
  let maxTo = "0000-01-01";
  let maxAvailable = "0000-01-01";

  for (const entry of items) {
    const p = entry.promise as DeliveryPromise;
    if (p.deliveryFrom < minFrom) minFrom = p.deliveryFrom;
    if (p.deliveryTo > maxTo) maxTo = p.deliveryTo;
    if (p.availableFrom > maxAvailable) maxAvailable = p.availableFrom;
  }

  return {
    sequence,
    items,
    promisedFrom: minFrom,
    promisedTo: maxTo,
    availableFrom: maxAvailable,
    promisable: true,
  };
}

// ─── Frontend grouping helper ──────────────────────────────────────────────

export interface CartLineForGrouping {
  productId: string;
  name: string;
  expectedAvailabilityDate?: string;
  stockStatus?: string;
}

/**
 * Convenience: computes estimates + groups for cart lines.
 * Used by cart/checkout preview. NOT authoritative.
 */
export function groupCartLinesForEstimate<T extends CartLineForGrouping>(
  lines: T[],
  config?: PromiseConfig & { toleranceBusinessDays?: number },
): DeliveryGroup<T>[] {
  const itemsWithPromise: ItemWithPromise<T>[] = lines.map((line) => ({
    item: line,
    promise: computeItemEstimate(line, config),
  }));

  return groupItemsByPromise(itemsWithPromise, {
    toleranceBusinessDays: config?.toleranceBusinessDays,
    holidays: config?.holidays,
  });
}
