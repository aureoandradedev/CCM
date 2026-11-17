import type { ShipmentStatus } from "./orders";

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  aguardando_disponibilidade: ["preparando", "cancelado"],
  preparando: ["pronto_para_envio", "pronto_para_retirada", "cancelado"],
  pronto_para_envio: ["enviado", "cancelado"],
  pronto_para_retirada: ["entregue", "cancelado"],
  enviado: ["entregue"],
  entregue: [],
  cancelado: [],
};

export const TERMINAL_STATUSES: ReadonlySet<ShipmentStatus> = new Set(["entregue", "cancelado"]);

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return SHIPMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateTransition(currentStatus: ShipmentStatus, targetStatus: ShipmentStatus): TransitionResult {
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return { valid: false, reason: `Status '${currentStatus}' é terminal; nenhuma transição permitida.` };
  }
  if (!canTransition(currentStatus, targetStatus)) {
    const allowed = SHIPMENT_TRANSITIONS[currentStatus];
    return {
      valid: false,
      reason: `Transição '${currentStatus}' → '${targetStatus}' não permitida. Válidas: ${allowed.join(", ") || "nenhuma"}.`,
    };
  }
  return { valid: true };
}

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  aguardando_disponibilidade: "Aguardando disponibilidade",
  preparando: "Preparando",
  pronto_para_envio: "Pronto para envio",
  pronto_para_retirada: "Pronto para retirada",
  enviado: "Enviado",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const SHIPMENT_EVENT_TYPES = {
  STATUS_CHANGED: "shipment_status_changed",
  TRACKING_SET: "shipment_tracking_set",
  OCCURRENCE: "shipment_occurrence",
} as const;

export type OccurrenceType = "attempt" | "delay" | "damage" | "return" | "note";

export const OCCURRENCE_LABELS: Record<OccurrenceType, string> = {
  attempt: "Tentativa de entrega",
  delay: "Atraso",
  damage: "Avaria em trânsito",
  return: "Devolução",
  note: "Observação",
};
