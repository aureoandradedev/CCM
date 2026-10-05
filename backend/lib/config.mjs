import "dotenv/config";

/** Leitura centralizada das variáveis (com defaults seguros). */
const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const num = (k, d) => {
  const n = Number(env(k, ""));
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  porta: num("PORTA", 4000),
  storeOrigins: env("STORE_ORIGINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  supabaseUrl: env("SUPABASE_URL"),
  supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),

  pagamentoMock: env("PAGAMENTO_MOCK") === "true",
  pagamentoMockPagoAposSeg: num("PAGAMENTO_MOCK_PAGO_APOS_SEG", 10),
  pixExpiracaoSegundos: num("PIX_EXPIRACAO_SEGUNDOS", 3600),
  lockTtlMs: num("PAGAMENTO_LOCK_TTL_MS", 120000),

  pedidoHmacSecret: env("PEDIDO_HMAC_SECRET"),
  pedidoMaxQtdUn: num("PEDIDO_MAX_QTD_UN", 9999),
  pedidoRateMax: num("PEDIDO_RATE_MAX", 30),
  pedidoRateWindowMs: num("PEDIDO_RATE_WINDOW_MS", 60000),

  qrofertasConfigurado: Boolean(env("QROFERTAS_EMAIL") && env("QROFERTAS_PASSWORD")),
  cieloConfigurado: Boolean(env("CIELO_MERCHANT_ID") && env("CIELO_MERCHANT_KEY")),
};

export function supabaseConfigurado() {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}
