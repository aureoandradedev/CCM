/**
 * Cobrança Pix e cartão, webhook, status e estorno — porte do index.js das
 * Cloud Functions do mercado para Supabase. As decisões do lock são as MESMAS
 * (lib/payment-lock.mjs, copiado sem alteração); o que muda é a persistência:
 * em vez de db.runTransaction, um UPDATE condicional (compare-and-set) no JSON
 * `payment_lock`, que o Postgres executa atomicamente.
 */
import { randomUUID } from "node:crypto";

import { config } from "./config.mjs";
import { gateway } from "./gateway.mjs";
import {
  lockAguardandoReconciliacao,
  lockChamandoGateway,
  lockConcluido,
  pagamentoAprovadoPorProvedor,
  pixReutilizavel,
  resolverTransacaoLock,
  sanitizeClientTag,
} from "./payment-lock.mjs";
import { ErroPedido } from "./pedido.mjs";
import { db, registrarEvento } from "./supabase.mjs";

const CAMPOS_CARTAO_PROIBIDOS = ["cardNumber", "cardnumber", "number", "pan", "cvv", "cvc", "securityCode", "expiration", "expiry", "holder", "cardHolder"];

const ORDER_COLS =
  "id, code, customer, payment_method, payment_status, payment_provider, order_status, total_centavos, pricing_version, cielo_payment_id, txid, pix_qr_code, pix_expires_at, payment_lock, refund_status, card_amount_centavos, paid_at, refund_request_id";

async function carregarPedido(orderId) {
  const { data, error } = await db().from("orders").select(ORDER_COLS).eq("id", orderId).maybeSingle();
  if (error) throw new ErroPedido(500, error.message);
  return data;
}

/** Forma que o lock puro espera (camelCase como no Firestore). */
function paraLock(order) {
  return {
    paymentStatus: order.payment_status,
    paymentLock: order.payment_lock,
    cieloPaymentId: order.cielo_payment_id,
    pixQrCode: order.pix_qr_code,
    pixExpiraEm: order.pix_expires_at ? new Date(order.pix_expires_at).getTime() : 0,
    orderStatus: order.order_status,
  };
}

/* ---------------- lock: compare-and-set no JSON ---------------- */
async function gravarLock(orderId, lockAtual, novoLock) {
  let q = db().from("orders").update({ payment_lock: novoLock }).eq("id", orderId);
  q = lockAtual ? q.eq("payment_lock->>updatedAt", String(lockAtual.updatedAt)) : q.is("payment_lock", null);
  const { data, error } = await q.select("id");
  if (error) throw new ErroPedido(500, error.message);
  return (data || []).length === 1;
}

async function adquirirLockPagamento(orderId, { fluxo, provider, clientTag }) {
  for (let i = 0; i < 3; i++) {
    const order = await carregarPedido(orderId);
    if (!order) return { decisao: { acao: "nao-encontrado" }, order: null };
    const agoraMs = Date.now();
    const { decisao, patch } = resolverTransacaoLock({ order: paraLock(order), agoraMs, lockTtlMs: config.lockTtlMs, orderId, fluxo, provider, clientTag });
    if (!patch) return { decisao, order };
    const ok = await gravarLock(orderId, order.payment_lock, patch.paymentLock);
    if (ok) return { decisao, order: { ...order, payment_lock: patch.paymentLock } };
  }
  return { decisao: { acao: "em-andamento", motivo: "concorrencia" }, order: null };
}

async function atualizarLock(orderId, lock) {
  const { error } = await db().from("orders").update({ payment_lock: lock }).eq("id", orderId);
  if (error) console.warn("[lock] falha ao atualizar", error.message);
}
async function marcarChamandoGateway(orderId, lock, { merchantOrderId, tipo }) {
  const novo = lockChamandoGateway({ atual: lock, merchantOrderId, tipo, agoraMs: Date.now() });
  await atualizarLock(orderId, novo);
  return novo;
}
async function concluirLock(orderId, lock, resultado, cieloPaymentId) {
  const novo = lockConcluido({ atual: lock, resultado, cieloPaymentId, agoraMs: Date.now() });
  await atualizarLock(orderId, novo);
  return novo;
}
async function marcarReconciliacao(orderId, lock, extra = {}) {
  const novo = lockAguardandoReconciliacao({ atual: lock, agoraMs: Date.now() });
  await db().from("orders").update({ payment_lock: novo, needs_payment_review: true, ...extra }).eq("id", orderId);
  return novo;
}

/** Marca pago de forma idempotente e promove aguardando-pagamento → em-separacao. */
export async function confirmarPedidoPago(orderId, extras = {}, actor = { kind: "system" }) {
  const { data, error } = await db()
    .from("orders")
    .update({ ...extras, payment_status: "pago", paid_at: new Date().toISOString() })
    .eq("id", orderId)
    .neq("payment_status", "pago")
    .select("id, order_status");
  if (error) throw new ErroPedido(500, error.message);
  const row = (data || [])[0];
  if (!row) return { promovido: false, jaEstavaPago: true };
  let promovido = false;
  if (row.order_status === "aguardando-pagamento") {
    await db().from("orders").update({ order_status: "em-separacao" }).eq("id", orderId).eq("order_status", "aguardando-pagamento");
    promovido = true;
  }
  await registrarEvento(orderId, "pagamento-confirmado", { ...extras, promovido }, actor);

  // R4.1b: materializar purchase_requirements (no-op se já materializado no checkout)
  try {
    await db().rpc("materialize_order_requirements", { p_order_id: orderId });
  } catch (e) {
    console.error("[materialize_requirements]", orderId, e?.message ?? e);
  }

  // Revogar tokens de acesso guest após pagamento
  try {
    await db().rpc("revoke_order_tokens", { p_order_id: orderId });
  } catch (e) {
    console.error("[revoke_tokens]", orderId, e?.message ?? e);
  }

  return { promovido, jaEstavaPago: false };
}

function guardaPedidoPagavel(order) {
  if (!order) throw new ErroPedido(404, "Pedido não encontrado.");
  if (order.order_status === "cancelado") throw new ErroPedido(409, "Pedido cancelado.");
  if (order.order_status !== "aguardando-pagamento") throw new ErroPedido(409, "Pedido não está liberado para pagamento.");
  if (["estornado", "processando", "incerto"].includes(order.refund_status || "")) throw new ErroPedido(409, "Pedido em estorno.");
  if (Number(order.total_centavos) < 1) throw new ErroPedido(400, "Valor do pedido inválido.");
}

function verificarPricingVersion(order, confirmedPricingVersion) {
  if (confirmedPricingVersion !== undefined && confirmedPricingVersion !== null && Number(confirmedPricingVersion) !== Number(order.pricing_version)) {
    throw new ErroPedido(409, "O valor do pedido foi atualizado. Confira e confirme de novo.", { pricingVersion: order.pricing_version, totalCentavos: order.total_centavos });
  }
}

/* =============================== PIX =============================== */
export async function criarPix({ orderId, clientTag, confirmedPricingVersion }) {
  if (!orderId) throw new ErroPedido(400, "orderId obrigatório.");
  let order = await carregarPedido(orderId);
  guardaPedidoPagavel(order);
  verificarPricingVersion(order, confirmedPricingVersion);

  if (order.payment_status === "pago") return { ok: true, orderId, orderCode: order.code, status: "pago", reaproveitado: true };
  if (pixReutilizavel({ order: paraLock(order), agoraMs: Date.now() })) {
    return { ok: true, orderId, orderCode: order.code, qrCodeString: order.pix_qr_code?.copiaECola || "", qrCodeBase64: order.pix_qr_code?.base64 || "", expiraEm: order.pix_expires_at, reaproveitado: true };
  }

  const { decisao, order: travado } = await adquirirLockPagamento(orderId, { fluxo: "pix", provider: "pix", clientTag: sanitizeClientTag(clientTag) });
  if (decisao.acao === "nao-encontrado") throw new ErroPedido(404, "Pedido não encontrado.");
  if (decisao.acao === "ja-pago") return { ok: true, orderId, orderCode: order.code, status: "pago", reaproveitado: true };
  if (decisao.acao === "em-andamento") throw new ErroPedido(409, "Pagamento em processamento. Aguarde alguns segundos.");
  if (decisao.acao === "ambiguo") throw new ErroPedido(409, "Pagamento em verificação. Fale com a televendas.", { emVerificacao: true });
  if (decisao.acao === "recuperar") {
    const c = await gateway.consultar(decisao.cieloPaymentId);
    if (pagamentoAprovadoPorProvedor(c.status, "pix")) {
      await confirmarPedidoPago(orderId, { payment_provider: gateway.provider(), cielo_payment_id: decisao.cieloPaymentId });
      await concluirLock(orderId, travado.payment_lock, "pago", decisao.cieloPaymentId);
      return { ok: true, orderId, orderCode: order.code, status: "pago", recuperado: true };
    }
    await concluirLock(orderId, travado.payment_lock, "negado", decisao.cieloPaymentId);
    return criarPix({ orderId, clientTag, confirmedPricingVersion });
  }

  order = travado;
  let lock = await marcarChamandoGateway(orderId, order.payment_lock, { merchantOrderId: order.code, tipo: "pix" });
  let cobranca;
  try {
    cobranca = await gateway.criarCobrancaPix({
      merchantOrderId: order.code,
      amountCentavos: order.total_centavos,
      expiracaoSegundos: config.pixExpiracaoSegundos,
      comprador: { nome: order.customer?.name, cpf: order.customer?.document },
    });
  } catch (e) {
    console.error("[pix] erro no gateway:", e?.response?.data || e.message);
    await marcarReconciliacao(orderId, lock);
    throw new ErroPedido(409, "Não foi possível gerar o Pix agora. Tente de novo em instantes.", { emVerificacao: true });
  }

  const expiraEm = new Date(Date.now() + config.pixExpiracaoSegundos * 1000).toISOString();
  await db()
    .from("orders")
    .update({
      payment_provider: gateway.provider() === "mock" ? "mock" : "cielo2",
      payment_method: "pix",
      cielo_payment_id: cobranca.paymentId,
      txid: cobranca.txid,
      pix_qr_code: { copiaECola: cobranca.qrCodeString, base64: cobranca.qrCodeBase64 },
      pix_expires_at: expiraEm,
      pix_amount_centavos: order.total_centavos,
    })
    .eq("id", orderId);
  await concluirLock(orderId, lock, "pix-gerado", cobranca.paymentId);
  await registrarEvento(orderId, "pix-gerado", { paymentId: cobranca.paymentId, expiraEm });

  return { ok: true, orderId, orderCode: order.code, qrCodeString: cobranca.qrCodeString, qrCodeBase64: cobranca.qrCodeBase64, expiraEm };
}

export async function statusPix(orderId) {
  const order = await carregarPedido(orderId);
  if (!order) throw new ErroPedido(404, "Pedido não encontrado.");
  if (order.payment_status === "pago") return { ok: true, status: "pago" };
  if (!order.cielo_payment_id) throw new ErroPedido(400, "Pedido sem cobrança Pix.");
  if (["estornado", "processando", "incerto"].includes(order.refund_status || "")) return { ok: true, status: "estornado" };
  const c = await gateway.consultar(order.cielo_payment_id);
  const status = gateway.traduzStatus(c.status);
  if (status === "pago") {
    await confirmarPedidoPago(orderId, {}, { kind: "system" });
    return { ok: true, status: "pago" };
  }
  return { ok: true, status };
}

/** Webhook Cielo: nunca confia no corpo; reconsulta. Sempre 200. */
export async function webhook(body) {
  const paymentId = String(body?.PaymentId || body?.paymentId || "").trim();
  if (!paymentId) return;
  try {
    const c = await gateway.consultar(paymentId);
    if (!pagamentoAprovadoPorProvedor(c.status, "pix")) return;
    const { data: order } = await db().from("orders").select("id, payment_status, refund_status").eq("cielo_payment_id", paymentId).limit(1).maybeSingle();
    if (!order) return;
    if (["estornado", "processando", "incerto"].includes(order.refund_status || "")) return;
    if (order.payment_status !== "pago") await confirmarPedidoPago(order.id, {}, { kind: "webhook" });
  } catch (e) {
    console.error("[webhook] erro:", e?.response?.data || e.message);
  }
}

/* =============================== CARTÃO =============================== */
export async function cobrarCartao(body) {
  for (const k of Object.keys(body || {})) {
    if (CAMPOS_CARTAO_PROIBIDOS.includes(k)) throw new ErroPedido(400, "Dados de cartão não podem ser enviados ao servidor.");
  }
  const { orderId, tipo, paymentToken, brand, dados3ds, clientTag, confirmedPricingVersion } = body || {};
  if (!orderId) throw new ErroPedido(400, "orderId obrigatório.");
  if (!["credito", "debito"].includes(tipo)) throw new ErroPedido(400, "Tipo de cartão inválido.");
  if (!paymentToken) throw new ErroPedido(400, "Token do cartão ausente.");
  if (tipo === "debito" && !dados3ds) throw new ErroPedido(400, "Débito exige autenticação 3DS.");

  let order = await carregarPedido(orderId);
  guardaPedidoPagavel(order);
  verificarPricingVersion(order, confirmedPricingVersion);
  if (order.payment_status === "pago") return { ok: true, orderId, orderCode: order.code, status: "pago", reaproveitado: true };

  const { decisao, order: travado } = await adquirirLockPagamento(orderId, { fluxo: "cartao", provider: "cartao", clientTag: sanitizeClientTag(clientTag) });
  if (decisao.acao === "nao-encontrado") throw new ErroPedido(404, "Pedido não encontrado.");
  if (decisao.acao === "ja-pago") return { ok: true, orderId, orderCode: order.code, status: "pago", reaproveitado: true };
  if (decisao.acao === "em-andamento") throw new ErroPedido(409, "Pagamento em processamento. Aguarde alguns segundos.");
  if (decisao.acao === "ambiguo") throw new ErroPedido(409, "Pagamento em verificação. Fale com a televendas antes de tentar de novo.", { emVerificacao: true });
  if (decisao.acao === "recuperar") {
    const c = await gateway.consultar(decisao.cieloPaymentId);
    if (pagamentoAprovadoPorProvedor(c.status, "cartao")) {
      await confirmarPedidoPago(orderId, { payment_provider: gateway.provider(), payment_method: `cartao-${travado.payment_lock?.tipo || tipo}`, cielo_payment_id: decisao.cieloPaymentId, card_amount_centavos: order.total_centavos });
      await concluirLock(orderId, travado.payment_lock, "pago", decisao.cieloPaymentId);
      return { ok: true, orderId, orderCode: order.code, status: "pago", recuperado: true };
    }
    await concluirLock(orderId, travado.payment_lock, "negado", decisao.cieloPaymentId);
    return cobrarCartao(body);
  }

  order = travado;
  const lock = await marcarChamandoGateway(orderId, order.payment_lock, { merchantOrderId: order.code, tipo });
  let venda;
  try {
    venda = await gateway.criarPagamentoCartao({
      merchantOrderId: order.code,
      amountCentavos: order.total_centavos,
      comprador: { nome: order.customer?.name, cpf: order.customer?.document },
      tipo,
      paymentToken,
      brand,
      dados3ds,
    });
  } catch (e) {
    console.error("[cartao] erro no gateway:", e?.response?.data || e.message);
    await marcarReconciliacao(orderId, lock);
    throw new ErroPedido(409, "Não foi possível concluir a cobrança. Não tente de novo antes de conferir com a televendas.", { emVerificacao: true });
  }

  if (pagamentoAprovadoPorProvedor(venda.status, "cartao")) {
    await confirmarPedidoPago(orderId, {
      payment_provider: gateway.provider(),
      payment_method: `cartao-${tipo}`,
      cielo_payment_id: venda.paymentId,
      card_amount_centavos: order.total_centavos,
      card_return_code: String(venda.returnCode ?? ""),
      card_return_message: String(venda.returnMessage ?? ""),
    });
    await concluirLock(orderId, lock, "pago", venda.paymentId);
    return { ok: true, orderId, orderCode: order.code, status: "pago" };
  }

  await db()
    .from("orders")
    .update({ payment_status: "negado", payment_provider: gateway.provider(), cielo_payment_id: venda.paymentId, card_return_code: String(venda.returnCode ?? ""), card_return_message: String(venda.returnMessage ?? "") })
    .eq("id", orderId);
  await concluirLock(orderId, lock, "negado", venda.paymentId);
  await registrarEvento(orderId, "cartao-negado", { returnCode: venda.returnCode, returnMessage: venda.returnMessage });
  throw new ErroPedido(402, "Pagamento não autorizado pela operadora. Confira os dados ou use outro cartão.", { returnCode: venda.returnCode });
}

export async function tokenSop() {
  const t = await gateway.gerarTokenSop();
  if (!t.accessToken) throw new ErroPedido(502, "Cielo não devolveu o token de sessão.");
  return { ok: true, ...t };
}
export async function token3ds() {
  const t = await gateway.gerarToken3ds();
  if (!t.accessToken) throw new ErroPedido(502, "Cielo não devolveu o token 3DS.");
  return { ok: true, ...t };
}

/* =============================== ESTORNO (admin) =============================== */
export async function estornar(orderId, admin) {
  if (!orderId) throw new ErroPedido(400, "orderId obrigatório.");
  const order = await carregarPedido(orderId);
  if (!order) throw new ErroPedido(404, "Pedido não encontrado.");
  if (order.refund_status === "estornado") return { ok: true, refundStatus: "estornado", msg: "Já estornado." };
  if (order.refund_status === "processando") throw new ErroPedido(409, "Estorno em andamento.");
  if (order.payment_status !== "pago") throw new ErroPedido(422, "Só é possível estornar pedido pago.");
  if (!["cielo", "mock"].includes(order.payment_provider || "")) throw new ErroPedido(422, "Estorno automático só para cartão Cielo.");
  if (!/^cartao-(credito|debito)$/.test(order.payment_method || "")) throw new ErroPedido(422, "Estorno automático só para cartão.");
  if (!order.cielo_payment_id) throw new ErroPedido(422, "Pedido sem PaymentId.");
  const amount = Number(order.card_amount_centavos || order.total_centavos);
  if (!(amount > 0)) throw new ErroPedido(422, "Valor inválido para estorno.");

  const refundRequestId = randomUUID();
  // claim transacional: só quem trocar de null/falhou para processando segue
  const { data: claim } = await db()
    .from("orders")
    .update({ refund_status: "processando", refund_request_id: refundRequestId })
    .eq("id", orderId)
    .or("refund_status.is.null,refund_status.eq.falhou")
    .select("id");
  if (!claim?.length) throw new ErroPedido(409, "Estorno já em processamento.");

  let refundStatus = "incerto";
  let detalhe = {};
  try {
    const r = await gateway.devolver(order.cielo_payment_id, amount, { requestId: refundRequestId });
    detalhe = { status: r.status, returnCode: r.returnCode, returnMessage: r.returnMessage };
    if (Number(r.status) === 10 || Number(r.status) === 11) refundStatus = "estornado";
    else if (Number(r.status) === 2) refundStatus = "falhou";
  } catch (e) {
    try {
      const c = await gateway.consultar(order.cielo_payment_id);
      detalhe = { reconsulta: c.status, erro: e.message };
      if (Number(c.status) === 10 || Number(c.status) === 11) refundStatus = "estornado";
      else if (Number(c.status) === 2) refundStatus = "falhou";
    } catch (e2) {
      detalhe = { erro: e.message, erroReconsulta: e2.message };
    }
  }

  await db()
    .from("orders")
    .update({
      refund_status: refundStatus,
      refund_confirmed_at: refundStatus === "estornado" ? new Date().toISOString() : null,
      payment_status: refundStatus === "estornado" ? "estornado" : order.payment_status,
    })
    .eq("id", orderId);
  await registrarEvento(orderId, refundStatus === "estornado" ? "estorno-sucesso" : "estorno-falha", { refundRequestId, refundStatus, ...detalhe }, { kind: "admin", id: admin?.id });

  if (refundStatus !== "estornado") throw new ErroPedido(502, refundStatus === "falhou" ? "A operadora recusou o estorno." : "Resultado do estorno incerto. Confira no painel da Cielo.", { refundStatus });
  return { ok: true, refundStatus };
}
