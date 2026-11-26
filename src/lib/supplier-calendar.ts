/**
 * Calendário real por fornecedor — funções puras.
 *
 * Três calendários separados:
 *   1. Fornecedor: pedido/lead (dias_pedido + business_hours + cutoff)
 *   2. CD: recebimento/processamento (feriados da cidade do CD)
 *   3. Cidade de destino: CCM→cliente (quando disponível)
 *
 * Regras:
 * - Cutoff real = close_time − lead_time_minutes
 * - Se fornecedor não abre no dia → localizar próximo dia válido (NÃO antecipar)
 * - Fallback chain: business_hours → cutoff_time → global → 17:30
 * - Holidays = merge national + state + municipal (dedup)
 */

import { addBusinessDays, nextOrderDay } from "./purchase-cycle.ts";

const BRAZIL_TZ = "America/Sao_Paulo";

function todayBR(): Date {
  const now = new Date();
  const brStr = now.toLocaleDateString("en-CA", { timeZone: BRAZIL_TZ });
  return new Date(brStr + "T12:00:00");
}

function nowBRTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-GB", {
    timeZone: BRAZIL_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DayHours {
  open: string;
  close: string;
}

export type BusinessHoursMap = Record<string, DayHours>;

export interface HolidayEntry {
  scope: "national" | "state" | "municipal";
  state_code?: string | null;
  city_name?: string | null;
  holiday_date: string;
}

export interface SupplierTermsForCalendar {
  dias_pedido: number[];
  cutoff_time?: string | null;
  business_hours?: BusinessHoursMap | null;
  lead_time_minutes?: number | null;
  prazo_entrega_cd_dias: number;
}

export interface CutoffResult {
  cutoffTime: string;
  isOpen: boolean;
}

// ─── Holiday resolution ────────────────────────────────────────────────────

/**
 * Resolve feriados para UM contexto geográfico (fornecedor OU CD OU cidade destino).
 * national + state do contexto + municipal do contexto. Dedup por data.
 *
 * Calendários são SEPARADOS por entidade:
 *   - Fornecedor: nacional + estadual/municipal do fornecedor
 *   - CD: nacional + estadual/municipal do CD
 *   - Destino: nacional + estadual/municipal da cidade de entrega (futuro)
 *
 * NÃO misturar: feriado do CD não bloqueia fornecedor e vice-versa.
 */
export function resolveHolidays(
  state: string | null | undefined,
  city: string | null | undefined,
  calendars: HolidayEntry[],
): string[] {
  const matched = new Set<string>();

  for (const h of calendars) {
    if (h.scope === "national") {
      matched.add(h.holiday_date);
      continue;
    }
    if (h.scope === "state") {
      if (state && h.state_code === state) {
        matched.add(h.holiday_date);
      }
      continue;
    }
    if (h.scope === "municipal") {
      if (state && city && h.state_code === state && h.city_name === city) {
        matched.add(h.holiday_date);
      }
    }
  }

  return [...matched].sort();
}

// ─── Cutoff resolution ─────────────────────────────────────────────────────

/**
 * Cutoff real para um fornecedor em um dia da semana.
 *
 * @param terms - condições comerciais ativas
 * @param dayOfWeekISO - 1=seg..7=dom (ISO)
 * @param globalCutoff - cutoff global (default "17:30")
 */
export function resolveSupplierCutoff(
  terms: Pick<SupplierTermsForCalendar, "business_hours" | "lead_time_minutes" | "cutoff_time"> | null,
  dayOfWeekISO: number,
  globalCutoff = "17:30",
): CutoffResult {
  if (!terms) {
    return { cutoffTime: globalCutoff, isOpen: true };
  }

  const bh = terms.business_hours;
  const lead = terms.lead_time_minutes ?? 30;
  const dowKey = String(dayOfWeekISO);

  if (bh && typeof bh === "object" && Object.keys(bh).length > 0) {
    const dayHours = bh[dowKey];
    if (dayHours && dayHours.close) {
      const cutoff = subtractMinutesFromTime(dayHours.close, lead);
      return { cutoffTime: cutoff, isOpen: true };
    }
    return { cutoffTime: "", isOpen: false };
  }

  if (terms.cutoff_time) {
    return { cutoffTime: terms.cutoff_time, isOpen: true };
  }

  return { cutoffTime: globalCutoff, isOpen: true };
}

/**
 * Subtrai minutos de um horário HH:MM.
 * Ex: subtractMinutesFromTime("17:00", 30) → "16:30"
 */
export function subtractMinutesFromTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  let totalMin = h * 60 + m - minutes;
  if (totalMin < 0) totalMin = 0;
  const rh = Math.floor(totalMin / 60);
  const rm = totalMin % 60;
  return `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
}

// ─── Next valid order day (considers everything together) ──────────────────

/**
 * Dia ISO da semana (1=seg..7=dom) a partir de Date JS.
 * JS getDay(): 0=dom..6=sab → ISO: 1=seg..7=dom
 */
function jsToIsoDow(d: Date): number {
  const jsDay = d.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Encontra o próximo dia válido de pedido considerando CONJUNTAMENTE:
 *   - dias_pedido (dias da semana permitidos)
 *   - business_hours (fornecedor aberto?)
 *   - feriados (fornecedor + CD)
 *   - cutoff + hora atual
 *
 * NÃO "antecipa para o dia anterior". Se hoje não é válido, avança.
 */
export function findNextValidOrderDay(
  terms: SupplierTermsForCalendar,
  holidays: string[],
  globalCutoff?: string,
  now?: { date: Date; time: string },
): Date | null {
  const currentDate = now?.date ?? todayBR();
  const currentTime = now?.time ?? nowBRTime();
  const holidaySet = new Set(holidays);

  if (!terms.dias_pedido || terms.dias_pedido.length === 0) return null;
  const diasSet = new Set(terms.dias_pedido);

  for (let i = 0; i < 15; i++) {
    const candidate = i === 0 ? currentDate : new Date(currentDate.getTime() + i * 86400000);
    const dateStr = formatDate(candidate);
    const jsDow = candidate.getDay();
    const isoDow = jsToIsoDow(candidate);

    if (!diasSet.has(jsDow)) continue;
    if (holidaySet.has(dateStr)) continue;

    const cutoff = resolveSupplierCutoff(terms, isoDow, globalCutoff);
    if (!cutoff.isOpen) continue;

    if (i === 0 && currentTime >= cutoff.cutoffTime) continue;

    return candidate;
  }

  return null;
}

// ─── V2 availability calculation ───────────────────────────────────────────

export interface AvailabilityResultV2 {
  orderDay: string;
  availabilityDate: string;
}

/**
 * Calcula data esperada de disponibilidade com calendários SEPARADOS.
 *
 * Calendário do fornecedor (nacional + estadual/municipal do fornecedor):
 *   → usado para findNextValidOrderDay (pedido)
 *
 * Calendário do CD (nacional + estadual/municipal do CD):
 *   → usado para addBusinessDays (trânsito/disponibilidade)
 *
 * NÃO mistura: feriado do CD não bloqueia pedido ao fornecedor e vice-versa.
 */
export function calculateExpectedAvailabilityDateV2(
  terms: SupplierTermsForCalendar,
  supplierState: string | null | undefined,
  supplierCity: string | null | undefined,
  cdState: string | null | undefined,
  cdCity: string | null | undefined,
  calendars: HolidayEntry[],
  globalCutoff?: string,
  now?: { date: Date; time: string },
): AvailabilityResultV2 | null {
  const supplierHolidays = resolveHolidays(supplierState, supplierCity, calendars);
  const cdHolidays = resolveHolidays(cdState, cdCity, calendars);

  const orderDay = findNextValidOrderDay(terms, supplierHolidays, globalCutoff, now);
  if (!orderDay) return null;

  const availability = addBusinessDays(orderDay, terms.prazo_entrega_cd_dias, cdHolidays);

  return {
    orderDay: formatDate(orderDay),
    availabilityDate: formatDate(availability),
  };
}

/**
 * Verifica se já passou do cutoff real de um fornecedor para agora.
 */
export function isAfterSupplierCutoff(
  terms: Pick<SupplierTermsForCalendar, "business_hours" | "lead_time_minutes" | "cutoff_time"> | null,
  globalCutoff?: string,
  now?: { date: Date; time: string },
): boolean {
  const currentDate = now?.date ?? todayBR();
  const currentTime = now?.time ?? nowBRTime();
  const isoDow = jsToIsoDow(currentDate);

  const cutoff = resolveSupplierCutoff(terms, isoDow, globalCutoff);
  if (!cutoff.isOpen) return true;
  return currentTime >= cutoff.cutoffTime;
}

// ─── Business-minute arithmetic ───────────────────────────────────────────

interface BusinessHoursConfig {
  business_hours?: BusinessHoursMap | null;
}

function getDayHours(
  config: BusinessHoursConfig | null,
  isoDow: number,
): DayHours | null {
  if (!config?.business_hours) return { open: "08:00", close: "18:00" };
  const h = config.business_hours[String(isoDow)];
  if (!h || !h.open || !h.close) return null;
  return h;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(totalMin: number): string {
  const clamped = Math.max(0, Math.min(1439, totalMin));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function advanceDay(d: Date): Date {
  return new Date(d.getTime() + 86400000);
}

/**
 * Adds `minutes` of business time to a starting instant.
 * Skips weekends, holidays, and hours outside business_hours.
 * Returns the resulting Date (with time set to the business-hour instant).
 *
 * Max lookahead: 60 days (prevents infinite loop on bad config).
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  config: BusinessHoursConfig | null,
  holidays: string[] = [],
): Date {
  if (minutes <= 0) return start;

  const holidaySet = new Set(holidays);
  let remaining = minutes;
  let current = new Date(start);
  const maxIter = 60 * 24;
  let iter = 0;

  while (remaining > 0 && iter++ < maxIter) {
    const dateStr = formatDate(current);
    const isoDow = jsToIsoDow(current);
    const hours = getDayHours(config, isoDow);

    if (!hours || holidaySet.has(dateStr)) {
      current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
      continue;
    }

    const openMin = timeToMinutes(hours.open);
    const closeMin = timeToMinutes(hours.close);
    const brStr = current.toLocaleTimeString("en-GB", {
      timeZone: BRAZIL_TZ,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    let currentMin = timeToMinutes(brStr);

    if (currentMin < openMin) currentMin = openMin;
    if (currentMin >= closeMin) {
      current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
      continue;
    }

    const availableToday = closeMin - currentMin;

    if (remaining <= availableToday) {
      const targetMin = currentMin + remaining;
      const targetTime = minutesToTime(targetMin);
      return new Date(
        dateStr +
          "T" +
          targetTime +
          ":00",
      );
    }

    remaining -= availableToday;
    current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
  }

  return current;
}

/**
 * Counts business minutes between two instants.
 * Only counts time within business_hours on non-holiday weekdays.
 *
 * Returns 0 if end <= start.
 */
export function businessMinutesBetween(
  start: Date,
  end: Date,
  config: BusinessHoursConfig | null,
  holidays: string[] = [],
): number {
  if (end <= start) return 0;

  const holidaySet = new Set(holidays);
  let total = 0;
  let current = new Date(start);
  const maxIter = 60 * 24;
  let iter = 0;

  while (current < end && iter++ < maxIter) {
    const dateStr = formatDate(current);
    const isoDow = jsToIsoDow(current);
    const hours = getDayHours(config, isoDow);

    if (!hours || holidaySet.has(dateStr)) {
      current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
      continue;
    }

    const openMin = timeToMinutes(hours.open);
    const closeMin = timeToMinutes(hours.close);

    const isSameDay = formatDate(current) === formatDate(end);

    const brStrStart = current.toLocaleTimeString("en-GB", {
      timeZone: BRAZIL_TZ,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    let startMin = timeToMinutes(brStrStart);
    if (startMin < openMin) startMin = openMin;
    if (startMin >= closeMin) {
      current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
      continue;
    }

    let endMin: number;
    if (isSameDay) {
      const brStrEnd = end.toLocaleTimeString("en-GB", {
        timeZone: BRAZIL_TZ,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      endMin = Math.min(timeToMinutes(brStrEnd), closeMin);
    } else {
      endMin = closeMin;
    }

    if (endMin > startMin) {
      total += endMin - startMin;
    }

    if (isSameDay) break;
    current = new Date(formatDate(advanceDay(current)) + "T00:00:00");
  }

  return total;
}
