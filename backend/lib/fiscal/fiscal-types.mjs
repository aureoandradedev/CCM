/**
 * Fiscal module constants and status definitions.
 * Desacoplado: CCM → FiscalService → UniplusDavAdapter → Uniplus
 */

export const FISCAL_STATUSES = [
  "pending",
  "sending",
  "created",
  "invoiced",
  "cancelled",
  "error",
];

export const FISCAL_STATUS_TRANSITIONS = {
  pending:   ["sending", "error", "cancelled"],
  sending:   ["created", "error"],
  created:   ["invoiced", "cancelled", "error"],
  invoiced:  [],
  cancelled: [],
  error:     ["pending", "sending"],
};

export const FISCAL_PROVIDERS = ["uniplus_dav"];

export const FISCAL_STRATEGIES = ["per_order", "per_shipment"];

export function canTransitionFiscal(from, to) {
  const allowed = FISCAL_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function isTerminalFiscalStatus(status) {
  return status === "invoiced" || status === "cancelled";
}

export const FISCAL_EVENT_TYPES = {
  CREATED:          "fiscal_doc_created",
  FOUND_IDEMPOTENT: "fiscal_doc_found_idempotent",
  STATUS_CHANGED:   "fiscal_doc_status_changed",
  INVOICED:         "fiscal_doc_invoiced",
  CANCELLED:        "fiscal_doc_cancelled",
  SEND_FAILED:      "fiscal_doc_send_failed",
  SYNC_STARTED:     "fiscal_doc_sync_started",
  SYNC_COMPLETED:   "fiscal_doc_sync_completed",
};
