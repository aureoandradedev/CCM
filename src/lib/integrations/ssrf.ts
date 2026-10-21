/**
 * Validação de URL para integrações REST/feed.
 *
 * Superfície de SSRF: fornecedor configura uma URL que o servidor pode
 * eventualmente acessar. Bloqueios em 3 camadas:
 *
 * 1. Estática — validateIntegrationUrl() (síncrona):
 *    bloqueia hostnames conhecidos, IPs privados literais, metadata endpoints,
 *    protocolos não-HTTPS, credenciais na URL.
 *
 * 2. DNS — resolveAndValidateUrl() (assíncrona, server-only):
 *    resolve hostname via DNS, valida TODOS os IPs retornados contra ranges
 *    privados/reservados. Impede bypass por hostname público apontando para
 *    IP privado (ex: evil.example → 127.0.0.1).
 *
 * 3. Redirect — safeFetch() (server-only):
 *    segue redirects manualmente com limite; cada destino passa por
 *    resolveAndValidateUrl(); somente HTTPS permitido em toda a cadeia.
 *
 * LIMITAÇÃO TOCTOU / DNS REBINDING DINÂMICO:
 *   Entre resolveAndValidateUrl() e a conexão HTTP real, o DNS pode ser
 *   rebindado (TTL curto). O executor HTTP futuro DEVE conectar usando o IP
 *   validado diretamente (ex: custom dns.lookup no http.Agent do Node / undici
 *   connect callback com IP pinning) em vez de permitir re-resolução.
 *   Até lá, esta limitação está documentada e aceita como risco residual
 *   mitigado pelo fato de não haver fetch real nesta fase.
 */

// ─── Hosts e sufixos bloqueados por nome ────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".test", ".internal"];

// ─── Ranges de IP bloqueados ────────────────────────────────────────────────

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^224\./,
  /^240\./,
  /^255\.255\.255\.255$/,
];

const PRIVATE_IPV6_PATTERNS: RegExp[] = [
  /^::1$/,
  /^::$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^ff[0-9a-f]{2}:/i,
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/i,
  /^2001:db8:/i,
  /^100::/i,
];

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface UrlValidation {
  valid: boolean;
  error?: string;
  resolvedIps?: string[];
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// ─── Verificação de IP ──────────────────────────────────────────────────────

export function isBlockedIp(ip: string): boolean {
  for (const p of PRIVATE_IPV4_PATTERNS) {
    if (p.test(ip)) return true;
  }
  for (const p of PRIVATE_IPV6_PATTERNS) {
    if (p.test(ip)) return true;
  }
  return false;
}

// ─── 1. Validação estática (síncrona) ───────────────────────────────────────

export function validateIntegrationUrl(raw: string): UrlValidation {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, error: "URL invalida." };
  }

  if (url.protocol !== "https:") {
    return {
      valid: false,
      error: `Protocolo nao permitido: ${url.protocol} — use HTTPS.`,
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Host bloqueado: ${hostname}` };
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        valid: false,
        error: `Host local/interno nao permitido: ${hostname}`,
      };
    }
  }

  const bareIp = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (isBlockedIp(bareIp)) {
    return { valid: false, error: "Endereco de rede privada nao permitido." };
  }

  if (url.username || url.password) {
    return {
      valid: false,
      error: "Credenciais na URL nao sao permitidas. Use o campo de credenciais.",
    };
  }

  return { valid: true };
}

// ─── 2. Validação com resolução DNS (server-only) ──────────────────────────

export async function resolveAndValidateUrl(
  raw: string,
): Promise<UrlValidation> {
  const staticCheck = validateIntegrationUrl(raw);
  if (!staticCheck.valid) return staticCheck;

  const url = new URL(raw);
  const hostname = url.hostname;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[")) {
    return { valid: true, resolvedIps: [hostname.replace(/^\[|\]$/g, "")] };
  }

  const { lookup } = await import("dns/promises");

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { valid: false, error: `DNS nao resolvido para: ${hostname}` };
  }

  if (addresses.length === 0) {
    return { valid: false, error: `Nenhum IP retornado para: ${hostname}` };
  }

  const resolvedIps = addresses.map((a) => a.address);

  for (const ip of resolvedIps) {
    if (isBlockedIp(ip)) {
      return {
        valid: false,
        error: `Host ${hostname} resolve para IP bloqueado: ${ip}`,
        resolvedIps,
      };
    }
  }

  return { valid: true, resolvedIps };
}

// ─── 3. Política de redirect + fetch seguro (server-only) ──────────────────

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const initialCheck = await resolveAndValidateUrl(url);
  if (!initialCheck.valid) {
    throw new SsrfError(`SSRF bloqueado na URL inicial: ${initialCheck.error}`);
  }

  let currentUrl = url;
  let remaining = MAX_REDIRECTS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const status = resp.status;
    if (status < 300 || status >= 400) {
      const cl = resp.headers.get("content-length");
      if (cl && parseInt(cl, 10) > MAX_RESPONSE_BYTES) {
        throw new SsrfError(
          `Resposta excede limite de ${MAX_RESPONSE_BYTES} bytes.`,
        );
      }
      return resp;
    }

    if (remaining <= 0) {
      throw new SsrfError(
        `Limite de ${MAX_REDIRECTS} redirects excedido.`,
      );
    }

    const location = resp.headers.get("location");
    if (!location) {
      throw new SsrfError("Redirect sem header Location.");
    }

    const redirectUrl = new URL(location, currentUrl).href;
    const redirectCheck = await resolveAndValidateUrl(redirectUrl);
    if (!redirectCheck.valid) {
      throw new SsrfError(
        `Redirect bloqueado (${currentUrl} → ${redirectUrl}): ${redirectCheck.error}`,
      );
    }

    currentUrl = redirectUrl;
    remaining--;
  }
}
