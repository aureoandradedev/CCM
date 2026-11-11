/**
 * Armazenamento LOCAL (localStorage) das integrações conectadas nesta sessão.
 *
 * É a FUNDAÇÃO de frontend: faz a área "Integrações" refletir o que o
 * fornecedor acabou de conectar no wizard, sem depender de backend. No CCM
 * final, isto é substituído pela leitura das tabelas do Supabase
 * (ver supabase/migrations/0002_integrations.sql), isoladas por fornecedor.
 *
 * NUNCA guarda segredo: tokens/senhas de ERP não entram aqui (nem no backend em
 * texto puro). Guardamos só metadados e, no máximo, os 4 últimos dígitos de uma
 * chave para exibição.
 *
 * Exposto como "external store" (subscribe/getSnapshot) para uso com
 * useSyncExternalStore — snapshot estável, sem setState em efeito e sem
 * mismatch de hidratação (no servidor devolve lista vazia).
 */
import type { IntegrationMethod, SyncCapability } from "./types";

export interface PipelineState {
  normalized: number;
  matched: number;
  review: number;
  offers: number;
  errors: number;
}

export interface ConnectedIntegration {
  id: string;
  method: IntegrationMethod;
  connectorId?: string; // ex.: "bling" quando method === "erp"
  name: string; // nome amigável exibido
  status: "connected" | "syncing" | "error" | "paused";
  productCount: number;
  validCount: number;
  errorCount: number;
  capabilities: SyncCapability[];
  autoSync: boolean;
  credentialLast4?: string; // só exibição, nunca o segredo
  createdAt: string; // ISO
  lastSyncAt: string | null; // ISO
  pipelineState?: PipelineState;
}

const KEY = "ccm_integrations_v1";
const EMPTY: ReadonlyArray<ConnectedIntegration> = Object.freeze([]);

let cache: ConnectedIntegration[] | null = null;
const listeners = new Set<() => void>();

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function load(): ConnectedIntegration[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConnectedIntegration[]) : [];
  } catch {
    return [];
  }
}

function ensureCache(): ConnectedIntegration[] {
  if (cache === null) cache = load();
  return cache;
}

function commit(next: ConnectedIntegration[]): void {
  cache = next;
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // modo privado / storage cheio: segue só em memória nesta sessão
    }
  }
  listeners.forEach((l) => l());
}

// ---- API de leitura imperativa (usada pontualmente) ----
export function listIntegrations(): ConnectedIntegration[] {
  return ensureCache();
}

// ---- external store (useSyncExternalStore) ----
export function subscribeIntegrations(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = load();
      listeners.forEach((l) => l());
    }
  };
  if (canUseStorage()) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (canUseStorage()) window.removeEventListener("storage", onStorage);
  };
}

export function getIntegrationsSnapshot(): ConnectedIntegration[] {
  return ensureCache();
}

export function getServerIntegrationsSnapshot(): ConnectedIntegration[] {
  return EMPTY as ConnectedIntegration[];
}

// ---- mutações ----
export function saveIntegration(entry: ConnectedIntegration): void {
  const list = ensureCache();
  const idx = list.findIndex((i) => i.id === entry.id);
  const next = idx >= 0 ? list.map((i) => (i.id === entry.id ? entry : i)) : [entry, ...list];
  commit(next);
}

export function updateIntegration(id: string, patch: Partial<ConnectedIntegration>): void {
  const next = ensureCache().map((i) => (i.id === id ? { ...i, ...patch } : i));
  commit(next);
}

export function removeIntegration(id: string): void {
  commit(ensureCache().filter((i) => i.id !== id));
}

export function newIntegrationId(): string {
  return `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
