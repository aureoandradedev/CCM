/**
 * Supplier performance — pure types and aggregation functions.
 * Observational only: NO scores, NO rankings, NO automatic actions.
 */

export const PERFORMANCE_EVENT_TYPES = [
  "po_sent",
  "po_confirmed",
  "po_confirmation_timeout",
  "delivery_on_time",
  "delivery_late",
  "receiving_full_match",
  "receiving_shortage",
  "receiving_excess",
  "receiving_damage",
  "receiving_swap",
  "cut_from_cycle",
] as const;

export type PerformanceEventType = (typeof PERFORMANCE_EVENT_TYPES)[number];

export const PERFORMANCE_EVENT_LABEL: Record<PerformanceEventType, string> = {
  po_sent: "PO enviado",
  po_confirmed: "PO confirmado",
  po_confirmation_timeout: "Timeout de confirmação",
  delivery_on_time: "Entrega pontual",
  delivery_late: "Entrega atrasada",
  receiving_full_match: "Recebimento perfeito",
  receiving_shortage: "Falta no recebimento",
  receiving_excess: "Excesso no recebimento",
  receiving_damage: "Avaria no recebimento",
  receiving_swap: "Troca no recebimento",
  cut_from_cycle: "Cortado do ciclo",
};

export interface PerformanceEvent {
  id: string;
  supplier_id: string;
  event_type: PerformanceEventType;
  reference_type: string | null;
  reference_id: string | null;
  metric_value: number | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface SupplierOperationalKpis {
  posSent: number;
  posConfirmed: number;
  confirmationRate: number | null;
  avgConfirmationHours: number | null;
  receivingsFullMatch: number;
  receivingsWithShortage: number;
  receivingsWithExcess: number;
  receivingsWithDamage: number;
  receivingsWithSwap: number;
  shortageRate: number | null;
  damageRate: number | null;
  excessRate: number | null;
  swapRate: number | null;
  deliveriesOnTime: number;
  deliveriesLate: number;
  onTimeRate: number | null;
  cutFromCycle: number;
  totalEvents: number;
}

export function aggregateOperationalKpis(events: PerformanceEvent[]): SupplierOperationalKpis {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
  }

  const posSent = counts.po_sent || 0;
  const posConfirmed = counts.po_confirmed || 0;
  const receivingsFullMatch = counts.receiving_full_match || 0;
  const receivingsWithShortage = counts.receiving_shortage || 0;
  const receivingsWithExcess = counts.receiving_excess || 0;
  const receivingsWithDamage = counts.receiving_damage || 0;
  const receivingsWithSwap = counts.receiving_swap || 0;
  const deliveriesOnTime = counts.delivery_on_time || 0;
  const deliveriesLate = counts.delivery_late || 0;
  const cutFromCycle = counts.cut_from_cycle || 0;

  const totalReceivings = receivingsFullMatch + receivingsWithShortage;
  const totalDeliveries = deliveriesOnTime + deliveriesLate;

  const confirmationHours = events
    .filter((e) => e.event_type === "po_confirmed" && typeof e.metric_value === "number")
    .map((e) => e.metric_value!);
  const avgConfirmationHours =
    confirmationHours.length > 0
      ? Math.round((confirmationHours.reduce((a, b) => a + b, 0) / confirmationHours.length) * 10) / 10
      : null;

  return {
    posSent,
    posConfirmed,
    confirmationRate: posSent > 0 ? Math.round((posConfirmed / posSent) * 1000) / 10 : null,
    avgConfirmationHours,
    receivingsFullMatch,
    receivingsWithShortage,
    receivingsWithExcess,
    receivingsWithDamage,
    receivingsWithSwap,
    shortageRate: totalReceivings > 0 ? Math.round((receivingsWithShortage / totalReceivings) * 1000) / 10 : null,
    damageRate: totalReceivings > 0 ? Math.round((receivingsWithDamage / totalReceivings) * 1000) / 10 : null,
    excessRate: totalReceivings > 0 ? Math.round((receivingsWithExcess / totalReceivings) * 1000) / 10 : null,
    swapRate: totalReceivings > 0 ? Math.round((receivingsWithSwap / totalReceivings) * 1000) / 10 : null,
    deliveriesOnTime,
    deliveriesLate,
    onTimeRate: totalDeliveries > 0 ? Math.round((deliveriesOnTime / totalDeliveries) * 1000) / 10 : null,
    cutFromCycle,
    totalEvents: events.length,
  };
}
