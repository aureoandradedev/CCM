"use server";

import type { ActionState } from "@/app/conta/actions";
import type { CanonicalProduct } from "@/lib/integrations/types";
import type { PipelineCounts } from "./sync-pipeline";

// ── Tipos de retorno (preservados para evitar quebra de imports) ─────

export interface CatalogImportInput {
  sourceType: "csv" | "xlsx" | "manual";
  sourceName: string;
  products: CanonicalProduct[];
  totals: { total: number; valid: number; invalid: number; warnings: number };
}

export interface CatalogImportResult {
  ok: boolean;
  catalogId?: string;
  error?: string;
  errorCode?: "auth_required" | "supplier_not_linked";
  counts?: { total: number; inserted: number; errors: number; warnings: number };
  pipeline?: PipelineCounts;
}

export interface OnboardingStatus {
  authenticated: boolean;
  linked: boolean;
  pending: { id: string; supplierName: string; requestedAt: string } | null;
}

export interface SupplierRegistrationResult {
  ok: boolean;
  error?: string;
  supplierId?: string;
  conflict?: boolean;
}

export interface TermsState {
  ok?: string;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════
// TODAS AS ACTIONS ABAIXO ESTÃO DESATIVADAS (fail-closed).
// O fornecedor não opera mais diretamente o CCM.
// Cadastro, importação e condições comerciais são feitos pelo admin.
// ════════════════════════════════════════════════════════════════════════

const DISABLED_MSG = "Funcionalidade desativada. Entre em contato com a equipe comercial.";

/** @deprecated Fornecedor não opera mais o CCM. */
export async function importCatalog(_input: CatalogImportInput): Promise<CatalogImportResult> {
  return { ok: false, error: "Importação por fornecedor desativada. O catálogo é importado pela equipe de compras." };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function registerSupplier(_input: {
  cnpj: string;
  trade_name: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  city: string;
  state: string;
}): Promise<SupplierRegistrationResult> {
  return { ok: false, error: "Cadastro de fornecedor desativado. Entre em contato com a equipe comercial." };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function requestSupplierAccess(_cnpj: string): Promise<SupplierRegistrationResult> {
  return { ok: false, error: "Solicitação de acesso desativada. Entre em contato com a equipe comercial." };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return { authenticated: false, linked: false, pending: null };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function signInForImport(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return { error: DISABLED_MSG };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function signUpForImport(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return { error: DISABLED_MSG };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function getSupplierTermsStatus() {
  return { supplierId: null, operational: false, pending: null, current: null };
}

/** @deprecated Fornecedor não opera mais o CCM. */
export async function proposeTerms(_prev: TermsState, _fd: FormData): Promise<TermsState> {
  return { error: "Proposta de condições comerciais desativada. As condições são definidas pela equipe de compras." };
}
