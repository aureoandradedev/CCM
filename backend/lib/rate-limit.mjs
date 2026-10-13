import rateLimit from "express-rate-limit";

const msg = { ok: false, erro: "Muitas requisições. Aguarde um minuto." };
const base = { standardHeaders: "draft-6", legacyHeaders: false, message: msg };

/** Pagamento / criação de pedido — 10 req/min por IP (compartilhado). */
export const limitPagamento = rateLimit({ ...base, windowMs: 60_000, max: 10 });

/** Tokens de cartão (SOP, 3DS) — 20 req/min por IP (compartilhado). */
export const limitToken = rateLimit({ ...base, windowMs: 60_000, max: 20 });

/** Consulta de pedido — 10 req/min por IP. */
export const limitConsulta = rateLimit({ ...base, windowMs: 60_000, max: 10 });

/** Cálculo de frete — 30 req/min por IP. */
export const limitFrete = rateLimit({ ...base, windowMs: 60_000, max: 30 });

/** Polling Pix status — 60 req/min por IP. */
export const limitPolling = rateLimit({ ...base, windowMs: 60_000, max: 60 });

/** Proxy de imagem público — 30 req/min por IP. */
export const limitProxy = rateLimit({ ...base, windowMs: 60_000, max: 30 });
