/**
 * Interface de connectors de integração (Fase 8).
 *
 * Cada connector traduz um sistema externo para ExternalCatalogItem[].
 * Nesta fase: FileConnector (CSV/XLSX) funcional, REST/Feed validam
 * configuração sem chamadas reais, LocalAgent é placeholder.
 */
import { z } from "zod";

import type {
  ExternalCatalogItem,
  IntegrationErrorKind,
  IntegrationMethod,
} from "./types";
import { validateIntegrationUrl } from "./ssrf";

// ─── Tipos de resultado ─────────────────────────────────────────────────────

export interface ConnectorCapabilities {
  full_catalog: boolean;
  incremental_sync: boolean;
  stock: boolean;
  cost: boolean;
  images: boolean;
  lead_time: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  errorKind?: IntegrationErrorKind;
}

export interface FetchResult {
  items: ExternalCatalogItem[];
  cursor?: string;
  hasMore?: boolean;
}

export interface IntegrationConfig {
  config: Record<string, unknown>;
  credentialRef?: string;
}

// ─── Schemas de config discriminados por tipo ──────────────────────────────

export const restConfigSchema = z.object({
  base_url: z.string().min(1, "URL base obrigatoria"),
  auth_type: z.enum(["bearer", "api_key", "basic", "none"]),
  catalog_endpoint: z.string().optional(),
  changes_endpoint: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const feedConfigSchema = z.object({
  feed_url: z.string().min(1, "URL do feed obrigatoria"),
  format: z.enum(["json", "xml", "csv"]),
  refresh_interval_minutes: z.number().int().min(5).optional(),
});

export const fileConfigSchema = z.object({
  format: z.enum(["csv", "xlsx"]).optional(),
  delimiter: z.string().max(1).optional(),
  encoding: z.string().optional(),
});

export const localAgentConfigSchema = z.object({});

const CONFIG_SCHEMAS: Record<string, z.ZodType> = {
  api: restConfigSchema,
  feed: feedConfigSchema,
  csv: fileConfigSchema,
  local_agent: localAgentConfigSchema,
};

export function validateConnectorConfig(
  method: string,
  config: unknown,
): { valid: boolean; errors?: string[] } {
  const schema = CONFIG_SCHEMAS[method];
  if (!schema) return { valid: false, errors: [`Metodo desconhecido: ${method}`] };

  const result = schema.safeParse(config);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  }

  if (method === "api") {
    const rc = config as { base_url: string };
    const urlCheck = validateIntegrationUrl(rc.base_url);
    if (!urlCheck.valid) return { valid: false, errors: [urlCheck.error!] };
  }
  if (method === "feed") {
    const fc = config as { feed_url: string };
    const urlCheck = validateIntegrationUrl(fc.feed_url);
    if (!urlCheck.valid) return { valid: false, errors: [urlCheck.error!] };
  }

  return { valid: true };
}

// ─── Credential resolver (server-only, nunca exportar para client) ─────────

export interface CredentialResolver {
  resolve(credentialRef: string): Promise<string>;
  exists(credentialRef: string): Promise<boolean>;
}

// ─── Interface ──────────────────────────────────────────────────────────────

export interface Connector {
  readonly type: IntegrationMethod;
  testConnection(cfg: IntegrationConfig): Promise<ConnectionTestResult>;
  fetchCatalog(cfg: IntegrationConfig): Promise<FetchResult>;
  fetchChanges?(cfg: IntegrationConfig, cursor: string): Promise<FetchResult>;
  getCapabilities(): ConnectorCapabilities;
}

// ─── File / CSV / XLSX ──────────────────────────────────────────────────────

export class FileConnector implements Connector {
  readonly type = "csv" as IntegrationMethod;

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, message: "Importacao por arquivo nao requer conexao." };
  }

  async fetchCatalog(): Promise<FetchResult> {
    throw new Error(
      "FileConnector.fetchCatalog: use o pipeline CSV/XLSX diretamente.",
    );
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      full_catalog: true,
      incremental_sync: false,
      stock: true,
      cost: true,
      images: true,
      lead_time: false,
    };
  }
}

// ─── REST / API ─────────────────────────────────────────────────────────────

export type RestConnectorConfig = z.infer<typeof restConfigSchema>;

export class RestConnector implements Connector {
  readonly type = "api" as IntegrationMethod;

  async testConnection(cfg: IntegrationConfig): Promise<ConnectionTestResult> {
    const configCheck = validateConnectorConfig("api", cfg.config);
    if (!configCheck.valid) {
      return {
        ok: false,
        message: configCheck.errors!.join("; "),
        errorKind: "configuration_error",
      };
    }

    const rc = cfg.config as RestConnectorConfig;
    if (rc.auth_type !== "none" && !cfg.credentialRef) {
      return {
        ok: false,
        message: "Credencial nao configurada.",
        errorKind: "authentication_error",
      };
    }

    return {
      ok: true,
      message: "Configuracao validada. Conexao real sera testada em fase futura.",
    };
  }

  async fetchCatalog(): Promise<FetchResult> {
    throw new Error(
      "RestConnector: chamadas HTTP reais nao implementadas nesta fase.",
    );
  }

  async fetchChanges(): Promise<FetchResult> {
    throw new Error(
      "RestConnector: delta sync nao implementado nesta fase.",
    );
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      full_catalog: true,
      incremental_sync: true,
      stock: true,
      cost: true,
      images: true,
      lead_time: true,
    };
  }
}

// ─── Feed ───────────────────────────────────────────────────────────────────

export type FeedConnectorConfig = z.infer<typeof feedConfigSchema>;

export class FeedConnector implements Connector {
  readonly type = "feed" as IntegrationMethod;

  async testConnection(cfg: IntegrationConfig): Promise<ConnectionTestResult> {
    const configCheck = validateConnectorConfig("feed", cfg.config);
    if (!configCheck.valid) {
      return {
        ok: false,
        message: configCheck.errors!.join("; "),
        errorKind: "configuration_error",
      };
    }

    return { ok: true, message: "Configuracao do feed validada." };
  }

  async fetchCatalog(): Promise<FetchResult> {
    throw new Error(
      "FeedConnector: fetch real nao implementado nesta fase.",
    );
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      full_catalog: true,
      incremental_sync: false,
      stock: true,
      cost: true,
      images: true,
      lead_time: false,
    };
  }
}

// ─── Local Agent (placeholder) ──────────────────────────────────────────────

export class LocalAgentConnector implements Connector {
  readonly type = "manual" as IntegrationMethod;

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: false,
      message: "Conector local nao disponivel nesta versao.",
      errorKind: "configuration_error",
    };
  }

  async fetchCatalog(): Promise<FetchResult> {
    throw new Error("LocalAgentConnector: nao implementado.");
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      full_catalog: true,
      incremental_sync: true,
      stock: true,
      cost: true,
      images: false,
      lead_time: true,
    };
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

const CONNECTORS: Record<string, Connector> = {
  csv: new FileConnector(),
  api: new RestConnector(),
  feed: new FeedConnector(),
  local_agent: new LocalAgentConnector(),
};

export function getConnector(method: string): Connector | undefined {
  return CONNECTORS[method];
}
