/* =========================================================
   🔒 Lock de pagamento idempotente (PR-1 fix/pagamento-idempotente).

   Decisões PURAS (sem Firestore, sem Cielo, sem rede) — 100% testáveis. O
   index.js aplica estas decisões DENTRO de db.runTransaction, então o que é
   testado aqui é exatamente o que roda em produção.

   Princípios:
   • A idempotencyKey é SEMPRE do servidor: `orderId:fluxo:attemptId`. O
     navegador NÃO escolhe/substitui/renova/força a chave. Ele pode mandar só
     uma `clientTag` informativa (correlação de UI/log), que NUNCA vira chave
     nem autoriza nova cobrança.
   • `attemptId` é do servidor e monotônico. Uma nova tentativa (após recusa ou
     Pix expirado) só nasce quando o SERVIDOR decide (tentativa anterior
     encerrada). Mudar um campo no navegador não cria tentativa nova.
   • Só UMA requisição concorrente cobra: a transação do Firestore serializa o
     doc; as demais leem o lock e recebem "em-andamento".
   • Janela de crash fechada: grava-se "chamando-gateway" ANTES da Cielo. Se o
     lock vencer nesse estado SEM paymentId, o resultado é AMBÍGUO → não
     recobrar, ir para reconciliação/revisão (fail-closed).
   • NÃO altera `paymentStatus` (pendente|pago|negado). O estado vive em
     `paymentLock.state`.

   Estados de paymentLock.state:
     adquirido               → lock tomado; gateway ainda não chamado
     chamando-gateway        → prestes a / chamando a Cielo (persistido ANTES)
     aguardando-reconciliacao→ AMBÍGUO (gateway pode ter cobrado; sem paymentId)
     concluido               → tentativa encerrada (pago | negado | pix-gerado)
     liberado                → liberado explicitamente (sem cobrança efetivada)
     aguardando-reconfirmacao→ liberado por MUDANÇA DE PREÇO/versão ANTES do gateway;
                               nenhuma chamada à Cielo ocorreu → a MESMA tentativa é
                               reusada (attemptId NÃO avança) na reconfirmação.
========================================================= */

// idempotencyKey SEMPRE server-side. Sem override do cliente. Lança se faltar base.
export function derivarIdempotencyKey({ orderId, fluxo, attemptId } = {}) {
  const oid = String(orderId || "").trim();
  if (!oid) throw new Error("orderId obrigatório para derivar idempotencyKey.");
  const f = (String(fluxo || "cobranca").trim()) || "cobranca";
  const a = Number(attemptId);
  if (!Number.isInteger(a) || a < 1) throw new Error("attemptId inválido para idempotencyKey.");
  return `${oid}:${f}:${a}`;
}

// Tag técnica do cliente: só correlação de UI/log. NUNCA é chave nem decide cobrança.
export function sanitizeClientTag(tag) {
  const s = String(tag ?? "").trim();
  return s ? s.slice(0, 120) : null;
}

const ESTADOS_ATIVOS = new Set(["adquirido", "chamando-gateway", "aguardando-reconciliacao"]);

// Decide a ação a partir do estado do pedido/lock. NUNCA se cobra sem passar aqui.
// Retorna { acao, proximoAttempt?, attemptId?, cieloPaymentId?, motivo }:
//   "ja-pago"      → pedido já pago; sucesso, NÃO cobrar.
//   "em-andamento" → tentativa em curso (lock fresco); NÃO cobrar (409).
//   "recuperar"    → há cieloPaymentId; consultar a Cielo pelo id antes de decidir.
//   "ambiguo"      → gateway pode ter cobrado e não há paymentId; reconciliar/revisar.
//   "adquirir"     → livre para adquirir o lock (proximoAttempt) e cobrar.
export function decidirAcaoPagamento({ paymentStatus, paymentLock, agoraMs, lockTtlMs } = {}) {
  if (String(paymentStatus) === "pago") return { acao: "ja-pago", motivo: "payment-status-pago" };

  const lock = paymentLock && typeof paymentLock === "object" ? paymentLock : null;

  // Sem lock ou tentativa encerrada/liberada → NOVA tentativa server-side.
  if (!lock || lock.state === "concluido" || lock.state === "liberado") {
    return { acao: "adquirir", proximoAttempt: Number(lock?.attemptId || 0) + 1, motivo: lock ? `apos-${lock.resultado || lock.state}` : "primeira" };
  }
  // Liberado por MUDANÇA DE PREÇO ANTES do gateway: NENHUMA chamada à Cielo ocorreu
  // nesta tentativa → readquire a MESMA (attemptId NÃO avança). A tentativa só é
  // "consumida" quando a chamada real ao gateway começa (chamando-gateway).
  if (lock.state === "aguardando-reconfirmacao") {
    return { acao: "adquirir", proximoAttempt: Number(lock.attemptId || 1), motivo: "reconfirmacao-preco" };
  }
  if (!ESTADOS_ATIVOS.has(lock.state)) {
    return { acao: "adquirir", proximoAttempt: Number(lock.attemptId || 0) + 1, motivo: "estado-desconhecido" };
  }

  // Estado ambíguo já persistido:
  if (lock.state === "aguardando-reconciliacao") {
    if (lock.cieloPaymentId) return { acao: "recuperar", cieloPaymentId: String(lock.cieloPaymentId), attemptId: Number(lock.attemptId || 0), motivo: "reconciliacao-com-paymentId" };
    return { acao: "ambiguo", attemptId: Number(lock.attemptId || 0), motivo: "reconciliacao-sem-paymentId" };
  }

  const inicio = Number(lock.startedAt || 0);
  const fresco = inicio > 0 && Number(agoraMs) - inicio <= Number(lockTtlMs || 0);
  if (fresco) return { acao: "em-andamento", attemptId: Number(lock.attemptId || 0), motivo: `lock-fresco-${lock.state}` };

  // Lock VENCIDO:
  if (lock.cieloPaymentId) return { acao: "recuperar", cieloPaymentId: String(lock.cieloPaymentId), attemptId: Number(lock.attemptId || 0), motivo: "vencido-com-paymentId" };
  if (lock.state === "chamando-gateway") return { acao: "ambiguo", attemptId: Number(lock.attemptId || 0), motivo: "gateway-iniciado-sem-paymentId" };
  // "adquirido" vencido: o gateway NUNCA foi chamado → seguro reusar a MESMA tentativa.
  return { acao: "adquirir", proximoAttempt: Number(lock.attemptId || 1), motivo: "adquirido-vencido-sem-gateway" };
}

/* ---- construtores de lock ---- */
export function lockAdquirido({ attemptId, idempotencyKey, provider, clientTag, agoraMs } = {}) {
  return {
    state: "adquirido",
    attemptId: Number(attemptId),
    idempotencyKey: String(idempotencyKey || ""),
    provider: String(provider || ""),
    clientTag: clientTag ? String(clientTag) : null,
    startedAt: Number(agoraMs),
    gatewayCallStartedAt: null,
    merchantOrderId: null,
    tipo: null,
    cieloPaymentId: null,
    resultado: null,
    updatedAt: Number(agoraMs),
  };
}
export function lockChamandoGateway({ atual, merchantOrderId, tipo, agoraMs } = {}) {
  const base = atual && typeof atual === "object" ? atual : {};
  return {
    ...base,
    state: "chamando-gateway",
    gatewayCallStartedAt: Number(agoraMs),
    merchantOrderId: merchantOrderId != null ? String(merchantOrderId) : base.merchantOrderId ?? null,
    tipo: tipo != null ? String(tipo) : base.tipo ?? null,
    updatedAt: Number(agoraMs),
  };
}
export function lockAguardandoReconciliacao({ atual, agoraMs } = {}) {
  const base = atual && typeof atual === "object" ? atual : {};
  return { ...base, state: "aguardando-reconciliacao", updatedAt: Number(agoraMs) };
}
export function lockConcluido({ atual, resultado, cieloPaymentId, agoraMs } = {}) {
  const base = atual && typeof atual === "object" ? atual : {};
  return {
    ...base,
    state: "concluido",
    resultado: resultado != null ? String(resultado) : base.resultado ?? null,
    cieloPaymentId: cieloPaymentId != null ? String(cieloPaymentId) : base.cieloPaymentId ?? null,
    updatedAt: Number(agoraMs),
  };
}
export function lockLiberado({ atual, agoraMs } = {}) {
  const base = atual && typeof atual === "object" ? atual : {};
  return { ...base, state: "liberado", updatedAt: Number(agoraMs) };
}
// Libera por MUDANÇA DE PREÇO/versão antes do gateway. Preserva attemptId (nenhuma
// tentativa foi ao gateway) e limpa marcas de chamada, para readquirir a MESMA tentativa.
export function lockAguardandoReconfirmacao({ atual, agoraMs } = {}) {
  const base = atual && typeof atual === "object" ? atual : {};
  return {
    ...base,
    state: "aguardando-reconfirmacao",
    resultado: "preco-alterado",
    gatewayCallStartedAt: null,
    cieloPaymentId: null,
    updatedAt: Number(agoraMs),
  };
}

// Resolve UMA execução da transação de lock a partir do estado LIDO do pedido.
// `patch` só é != null quando ADQUIRE (o chamador aplica com tx.update). A chave
// é SEMPRE derivada aqui (server-side) a partir do attemptId decidido.
export function resolverTransacaoLock({ order, agoraMs, lockTtlMs, orderId, fluxo, provider, clientTag } = {}) {
  if (!order || typeof order !== "object") return { decisao: { acao: "nao-encontrado" }, patch: null };
  const decisao = decidirAcaoPagamento({ paymentStatus: order.paymentStatus, paymentLock: order.paymentLock, agoraMs, lockTtlMs });
  if (decisao.acao === "adquirir") {
    const attemptId = Number(decisao.proximoAttempt);
    const idempotencyKey = derivarIdempotencyKey({ orderId, fluxo, attemptId });
    return {
      decisao: { ...decisao, attemptId, idempotencyKey },
      patch: { paymentLock: lockAdquirido({ attemptId, idempotencyKey, provider, clientTag, agoraMs }), updatedAt: Number(agoraMs) },
    };
  }
  return { decisao, patch: null };
}

// Pix ainda reutilizável? (cobrança existente + QR + não expirado). Reuso NÃO cria tentativa nova.
export function pixReutilizavel({ order, agoraMs } = {}) {
  const o = order || {};
  return !!(o.cieloPaymentId && o.pixQrCode && Number(o.pixExpiraEm || 0) > Number(agoraMs));
}

// Predicado puro da promoção "aguardando-pagamento" → "em-separacao" (idempotente).
export function devePromoverParaSeparacao(order) {
  return !!order && order.orderStatus === "aguardando-pagamento";
}

// Aprovado por provedor: cartão 2 (Paid) ou 1 (Authorized+captura); Pix só 2 (Paid).
export function pagamentoAprovadoPorProvedor(statusCielo, provider) {
  const s = Number(statusCielo);
  if (provider === "cartao" || provider === "entrega") return s === 2 || s === 1;
  return s === 2;
}
