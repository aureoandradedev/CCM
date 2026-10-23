/**
 * Tipos do orquestrador de compras (Fase 9).
 *
 * Estados operacionais e exceções — nenhum deles publica, escolhe
 * sourcing ou altera margem automaticamente.
 */

// ─── Estados operacionais ──────────────────────────────────────────────────

export type OperationalState =
  | "AUTO_OK"
  | "REVIEW_MATCH"
  | "REVIEW_RANKING"
  | "NO_OFFER"
  | "SOURCE_CHANGED";

// ─── Tipos de exceção ──────────────────────────────────────────────────────

export type ExceptionType =
  | "review_match"
  | "review_ranking"
  | "no_offer"
  | "no_master_candidate"
  | "source_changed"
  | "economy_opportunity"
  | "stale_sourcing"
  | "stale_publication"
  | "inactive_item";

export type ExceptionSeverity = "low" | "medium" | "high" | "critical";
export type ExceptionStatus = "open" | "resolved" | "dismissed";

export interface ProcurementException {
  type: ExceptionType;
  severity: ExceptionSeverity;
  entity_type: string;
  entity_id: string;
  master_product_id: string | null;
  supplier_id: string | null;
  title: string;
  detail: Record<string, unknown>;
  fingerprint: string;
}

// ─── Resultado do orquestrador ─────────────────────────────────────────────

export type RunStatus = "completed" | "partial" | "failed";

export interface OrchestratorPhaseResult {
  phase: string;
  processed: number;
  created: number;
  updated: number;
  errors: number;
  skipped: number;
  ok: boolean;
}

export interface OrchestratorResult {
  status: RunStatus;
  run_id: string;
  phases: OrchestratorPhaseResult[];
  exceptions_created: number;
  exceptions_auto_resolved: number;
  duration_ms: number;
  error?: string;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export interface AuditEntry {
  run_id: string;
  action: string;
  phase?: string;
  entity_type?: string;
  entity_id?: string;
  detail: Record<string, unknown>;
}
