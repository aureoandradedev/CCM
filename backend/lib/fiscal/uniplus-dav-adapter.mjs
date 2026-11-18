/**
 * Uniplus DAV Adapter — 4 operations against the Uniplus public-api/v1/davs.
 * When FISCAL_UNIPLUS_ENABLED=false (default), returns mock responses based on
 * real Multigiro payloads. No real HTTP calls unless enabled + configured.
 *
 * Auth: OAuth2 client_credentials → Bearer token (cached 50 min).
 * Endpoints: POST/GET /public-api/v1/davs, GET ?codigoECommerce.eq=X
 */
import { config } from "../config.mjs";

export class UniplusError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = "UniplusError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// ─── OAuth2 token cache ──────────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function ensureToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const url = `${config.uniplusBaseUrl}/oauth/token`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${config.uniplusToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=public-api",
      signal: AbortSignal.timeout(config.uniplusTimeoutMs),
    });
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    throw new UniplusError(
      isTimeout ? "Timeout na autenticação Uniplus" : `Erro de rede (OAuth): ${err.message}`,
      { retryable: true, code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR" },
    );
  }

  if (!res.ok) {
    throw new UniplusError(`Uniplus OAuth falhou (${res.status})`, {
      status: res.status,
      code: "AUTH_FAILED",
      retryable: res.status >= 500,
    });
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + 50 * 60 * 1000;
  return cachedToken;
}

function headersUniplus(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function ensureConfigured() {
  if (!config.uniplusBaseUrl || !config.uniplusToken) {
    throw new UniplusError("Credenciais Uniplus não configuradas (UNIPLUS_BASE_URL / UNIPLUS_TOKEN)", {
      code: "MISSING_CREDENTIALS",
    });
  }
}

// ─── Generic HTTP helper ─────────────────────────────────────────────

async function request(method, path, body = null) {
  ensureConfigured();
  const token = await ensureToken();
  const url = `${config.uniplusBaseUrl}${path}`;
  const opts = {
    method,
    headers: headersUniplus(token),
    signal: AbortSignal.timeout(config.uniplusTimeoutMs),
  };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    throw new UniplusError(
      isTimeout ? "Timeout na comunicação com Uniplus" : `Erro de rede: ${err.message}`,
      { retryable: true, code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR" },
    );
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 429;
    throw new UniplusError(
      `Uniplus respondeu ${res.status}: ${data?.message || res.statusText}`,
      { status: res.status, retryable, code: data?.code || "API_ERROR" },
    );
  }

  return data;
}

// ─── Mock responses (based on real Multigiro patterns) ───────────────

let mockCounter = 9000;

function mockCreateDav(payload) {
  const codigo = String(++mockCounter);
  return {
    codigo,
    codigoECommerce: payload?.dav?.codigoECommerce ?? null,
    status: 1,
    tipoDocumento: payload?.dav?.tipoDocumento ?? 1,
    data: payload?.dav?.data ?? new Date().toISOString().slice(0, 10),
    filial: payload?.dav?.filial ?? "",
    itens: payload?.dav?.itens ?? [],
  };
}

function mockGetDav(codigo) {
  return { codigo, status: 1, tipoDocumento: 1 };
}

// ─── 4 Public operations ─────────────────────────────────────────────

export async function createDav(davPayload) {
  const wrapped = davPayload?.dav ? davPayload : { dav: davPayload };
  if (!config.fiscalUniplusEnabled) {
    const mock = mockCreateDav(wrapped);
    return { codigo: mock.codigo, raw: mock };
  }
  const data = await request("POST", "/public-api/v1/davs", wrapped);
  const codigo = data?.codigo ?? data?.numero ?? data?.id ?? null;
  return { codigo: codigo ? String(codigo) : null, raw: data };
}

export async function getDavStatus(codigo) {
  if (!config.fiscalUniplusEnabled) {
    return { raw: mockGetDav(codigo) };
  }
  const data = await request("GET", `/public-api/v1/davs/${encodeURIComponent(codigo)}`);
  return { raw: data };
}

export async function findDavByCodigoEcommerce(codigoEcommerce) {
  if (!config.fiscalUniplusEnabled) {
    return { found: false, codigo: null, raw: null };
  }
  const data = await request("GET", `/public-api/v1/davs?codigoECommerce.eq=${encodeURIComponent(codigoEcommerce)}`);
  const lista = Array.isArray(data) ? data : data?.content || data?.items || data?.data || [];
  const dav = lista[0];
  if (!dav) return { found: false, codigo: null, raw: null };
  const codigo = dav.codigo ?? dav.numero ?? dav.id ?? null;
  return { found: true, codigo: codigo ? String(codigo) : null, raw: dav };
}

export async function cancelDav(codigo) {
  if (!config.fiscalUniplusEnabled) {
    return { raw: { codigo, status: 3 } };
  }
  return { raw: await request("DELETE", `/public-api/v1/davs/${encodeURIComponent(codigo)}`) };
}

export function adapterInfo() {
  return { mock: !config.fiscalUniplusEnabled, provider: "uniplus_dav" };
}

export function resetTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}
