import type { OccurrenceType } from "@/lib/shipment-lifecycle";

export interface ActionResult {
  ok?: string;
  error?: string;
}

export const ENTREGADOR_OCCURRENCE_TYPES: OccurrenceType[] = [
  "attempt", "delay", "damage", "return", "note",
];
