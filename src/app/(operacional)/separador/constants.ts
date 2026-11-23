export interface ActionResult {
  ok?: string;
  error?: string;
}

export const SEPARADOR_OCCURRENCE_TYPES = ["damage", "note"] as const;
export type SeparadorOccurrenceType = (typeof SEPARADOR_OCCURRENCE_TYPES)[number];
