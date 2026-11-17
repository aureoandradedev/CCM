/**
 * Cálculo de promessa de entrega e agrupamento de shipments (backend).
 *
 * Espelho server-side de src/lib/delivery-promise.ts.
 * Backend é AUTORIDADE — as datas gravadas aqui são snapshot imutável.
 */

export const TRANSIT_DAYS_MIN = 1;
export const TRANSIT_DAYS_MAX = 3;
export const GROUPING_TOLERANCE_BUSINESS_DAYS = 2;

function parseDate(iso) {
  return new Date(iso + "T12:00:00");
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function addBusinessDays(from, n, holidays = []) {
  const hSet = new Set(holidays);
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !hSet.has(formatDate(d))) added++;
  }
  return d;
}

export function businessDaysBetween(fromISO, toISO, holidays = []) {
  const from = parseDate(fromISO);
  const to = parseDate(toISO);
  if (to <= from) return 0;
  const hSet = new Set(holidays);
  let count = 0;
  const d = new Date(from);
  while (d < to) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !hSet.has(formatDate(d))) count++;
  }
  return count;
}

/**
 * Calcula promessa de entrega para um item.
 *
 * Regras:
 * 1. Se tem expected_availability_date (futura ou hoje) → usar
 * 2. Se tem stock > 0 (CCM) → hoje
 * 3. Senão → promisable = false (NÃO inventar prazo)
 */
export function computeItemPromise(input, config = {}) {
  const today = config.today ?? todayISO();
  const minTransit = config.transitDaysMin ?? TRANSIT_DAYS_MIN;
  const maxTransit = config.transitDaysMax ?? TRANSIT_DAYS_MAX;
  const holidays = config.holidays ?? [];

  let availableFrom = null;
  let source = "unknown";

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
 * Agrupa itens por promessa de entrega (tolerância em dias úteis).
 */
export function groupItemsByPromise(itemsWithPromise, config = {}) {
  const tolerance = config.toleranceBusinessDays ?? GROUPING_TOLERANCE_BUSINESS_DAYS;
  const holidays = config.holidays ?? [];

  const promisable = itemsWithPromise.filter((i) => i.promise.promisable);
  const unpromisable = itemsWithPromise.filter((i) => !i.promise.promisable);

  const sorted = [...promisable].sort((a, b) => a.promise.deliveryTo.localeCompare(b.promise.deliveryTo));

  const groups = [];
  let currentGroup = [];
  let groupFirstDeliveryTo = null;

  for (const entry of sorted) {
    if (groupFirstDeliveryTo === null) {
      currentGroup = [entry];
      groupFirstDeliveryTo = entry.promise.deliveryTo;
      continue;
    }
    const diff = businessDaysBetween(groupFirstDeliveryTo, entry.promise.deliveryTo, holidays);
    if (diff <= tolerance) {
      currentGroup.push(entry);
    } else {
      groups.push(buildGroup(currentGroup, groups.length + 1));
      currentGroup = [entry];
      groupFirstDeliveryTo = entry.promise.deliveryTo;
    }
  }
  if (currentGroup.length > 0) {
    groups.push(buildGroup(currentGroup, groups.length + 1));
  }

  const result = [...groups];

  if (unpromisable.length > 0) {
    result.push({ sequence: result.length + 1, items: unpromisable, promisable: false });
  }

  return result;
}

function buildGroup(items, sequence) {
  let minFrom = "9999-12-31";
  let maxTo = "0000-01-01";
  let maxAvailable = "0000-01-01";

  for (const entry of items) {
    const p = entry.promise;
    if (p.deliveryFrom < minFrom) minFrom = p.deliveryFrom;
    if (p.deliveryTo > maxTo) maxTo = p.deliveryTo;
    if (p.availableFrom > maxAvailable) maxAvailable = p.availableFrom;
  }

  return { sequence, items, promisedFrom: minFrom, promisedTo: maxTo, availableFrom: maxAvailable, promisable: true };
}

/**
 * Pipeline completo: itens → shipments prontos para o RPC.
 *
 * @param {Array} itens - itens montados por montarItens() (com product_id, stock, expected_availability_date)
 * @param {string} deliveryMethod - 'delivery' | 'pickup'
 * @param {number} freightCentavos - frete total do pedido
 * @param {object} [config] - { holidays }
 * @returns {Array} shipments formatados para p_shipments do RPC
 */
export function computeShipments(itens, deliveryMethod, freightCentavos, config = {}) {
  const itemsWithPromise = itens.map((item) => ({
    item,
    promise: computeItemPromise({
      expectedAvailabilityDate: item.expected_availability_date ?? null,
      stock: item.stock ?? null,
    }, config),
  }));

  const groups = groupItemsByPromise(itemsWithPromise, config);

  const n = groups.length || 1;
  const base = Math.floor(freightCentavos / n);
  const remainder = freightCentavos - base * n;

  return groups.map((g, i) => {
    const shipment = {
      sequence: g.sequence,
      delivery_method: deliveryMethod,
      product_ids: g.items.map((e) => e.item.product_id),
      freight_centavos: i === 0 ? base + remainder : base,
    };

    if (g.promisable) {
      shipment.status = "preparando";
      shipment.available_from = g.availableFrom;
      shipment.promised_from = g.promisedFrom;
      shipment.promised_to = g.promisedTo;
    } else {
      shipment.status = "aguardando_disponibilidade";
      shipment.available_from = null;
      shipment.promised_from = null;
      shipment.promised_to = null;
    }

    return shipment;
  });
}
