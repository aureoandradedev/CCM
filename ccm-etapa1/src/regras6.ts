// CCM — Bloco 1 V2, Etapa 6: Frontend display logic.
// Pure functions for CCM-aware order display, timeline, error handling.
// No browser/React dependencies — testable with node:test.

// ─── Types ────────────────────────────────────────────────────────────────

export interface CcmOrderDisplay {
  enabled: boolean;
  hasCcm: boolean;
  isCcmOnly: boolean;
  hasShortfall: boolean;
  items: CcmItemDisplay[];
  fetchError?: boolean;
}

export interface CcmItemDisplay {
  orderItemId: string;
  ccmQty: number;
  supplierQty: number;
  totalQty: number;
}

export interface TimelineStep {
  key: string;
  label: string;
}

export interface SuccessStep {
  title: string;
  text: string;
}

export interface PaymentErrorClassification {
  message: string;
  isShortfall: boolean;
  shouldRefresh: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

const FULL_TIMELINE: TimelineStep[] = [
  { key: "pedido-realizado", label: "Pedido realizado" },
  { key: "aguardando-confirmacao", label: "Confirmação dos fornecedores" },
  { key: "aguardando-pagamento", label: "Pagamento" },
  { key: "em-separacao", label: "Em separação" },
  { key: "separados", label: "Pronto para envio" },
  { key: "enviado", label: "A caminho" },
  { key: "entregue", label: "Entregue" },
  { key: "pagos", label: "Finalizado" },
];

const CCM_ONLY_TIMELINE: TimelineStep[] = [
  { key: "pedido-realizado", label: "Pedido realizado" },
  { key: "aguardando-pagamento", label: "Pagamento" },
  { key: "em-separacao", label: "Em separação" },
  { key: "separados", label: "Pronto para envio" },
  { key: "enviado", label: "A caminho" },
  { key: "entregue", label: "Entregue" },
  { key: "pagos", label: "Finalizado" },
];

const SUCCESS_STEPS_FULL: SuccessStep[] = [
  { title: "Pedido registrado", text: "Seu pedido foi recebido e enviado aos fornecedores para confirmação de disponibilidade." },
  { title: "Confirmação de disponibilidade", text: "Os fornecedores confirmam os itens. Você será notificado quando tudo estiver pronto." },
  { title: "Pagamento liberado", text: "Após a confirmação, você escolhe a forma de pagamento e finaliza." },
];

const SUCCESS_STEPS_CCM_ONLY: SuccessStep[] = [
  { title: "Pedido registrado", text: "Seu pedido foi recebido. Todos os itens estão disponíveis para entrega imediata." },
  { title: "Pagamento", text: "Escolha a forma de pagamento e finalize seu pedido." },
];

// ─── 1. Timeline steps ───────────────────────────────────────────────────

export function getTimelineSteps(ccmInfo: CcmOrderDisplay | null): TimelineStep[] {
  if (!ccmInfo?.enabled || !ccmInfo.hasCcm) return FULL_TIMELINE;
  if (ccmInfo.isCcmOnly) return CCM_ONLY_TIMELINE;
  return FULL_TIMELINE;
}

// ─── 2. Per-item CCM display ─────────────────────────────────────────────

export function formatItemCcmStatus(
  item: CcmItemDisplay,
  unit: string,
): { available: string | null; pending: string | null } | null {
  if (item.totalQty <= 0) return null;

  if (item.ccmQty >= item.totalQty) {
    return { available: "Disponível", pending: null };
  }
  if (item.ccmQty <= 0) {
    return { available: null, pending: "Em confirmação" };
  }
  return {
    available: `${item.ccmQty} ${unit} disponível`,
    pending: `${item.supplierQty} ${unit} em confirmação`,
  };
}

// ─── 3. Adjustment banner ────────────────────────────────────────────────

export function shouldShowAdjustmentBanner(
  orderStatus: string,
  ccmInfo: CcmOrderDisplay | null,
): boolean {
  if (!ccmInfo?.enabled) return false;
  return ccmInfo.hasShortfall && orderStatus === "aguardando-confirmacao";
}

export function getAdjustmentMessage(): { title: string; body: string } {
  return {
    title: "Ajustamos seu pedido antes do pagamento.",
    body: "Parte dos itens não está mais disponível para entrega imediata. Estamos confirmando a quantidade restante antes de liberar o pagamento.",
  };
}

// ─── 4. Ready-for-payment banner ─────────────────────────────────────────

export function getReadyForPaymentMessage(
  ccmInfo: CcmOrderDisplay | null,
): { title: string; body: string } {
  if (ccmInfo?.enabled && ccmInfo.isCcmOnly && !ccmInfo.hasShortfall) {
    return {
      title: "Seu pedido está pronto para pagamento.",
      body: "Todos os itens estão disponíveis. Escolha a forma de pagamento para concluir.",
    };
  }
  if (ccmInfo?.enabled && ccmInfo.hasShortfall) {
    return {
      title: "Seu pedido está pronto para pagamento.",
      body: "Todos os itens foram confirmados. Agora falta apenas realizar o pagamento.",
    };
  }
  return {
    title: "Os fornecedores confirmaram seu pedido.",
    body: "Agora falta apenas realizar o pagamento para continuarmos com a preparação.",
  };
}

// ─── 5. Payment error handling ───────────────────────────────────────────

const TECHNICAL_PATTERNS = [
  /\brpc\b/i, /\bfunction\b/i, /\bsql\b/i, /\bdatabase\b/i,
  /\bsupabase\b/i, /\bpostgres/i, /stock_reservation/i,
  /payment_lock/i, /supplier_request/i, /ccm_inventory/i,
  /internal server/i, /unexpected token/i,
];

export function sanitizePaymentError(
  status: number,
  data: Record<string, unknown>,
): PaymentErrorClassification {
  if (status === 409 && data.ccmShortfall === true) {
    return {
      message: "Ajustamos seu pedido antes do pagamento. Acompanhe o status para saber quando o pagamento será liberado.",
      isShortfall: true,
      shouldRefresh: true,
    };
  }

  if (status === 409 && typeof data.pricingVersion === "number") {
    return { message: "", isShortfall: false, shouldRefresh: false };
  }

  if (status === 402) {
    return {
      message: "Pagamento não autorizado pela operadora. Confira os dados ou use outro cartão.",
      isShortfall: false,
      shouldRefresh: false,
    };
  }

  if (status === 409) {
    return {
      message: "Não foi possível processar o pagamento neste momento. Verifique o status do seu pedido.",
      isShortfall: false,
      shouldRefresh: true,
    };
  }

  const rawMessage = String(data.erro ?? "");
  const isTechnical = TECHNICAL_PATTERNS.some((p) => p.test(rawMessage));
  if (isTechnical || status >= 500) {
    return {
      message: "Não foi possível atualizar a disponibilidade do seu pedido agora. Tente novamente.",
      isShortfall: false,
      shouldRefresh: false,
    };
  }

  return {
    message: rawMessage || "Não foi possível concluir o pagamento. Tente novamente.",
    isShortfall: false,
    shouldRefresh: false,
  };
}

// ─── 6. Success page steps ───────────────────────────────────────────────

export function getSuccessSteps(ccmInfo: CcmOrderDisplay | null): SuccessStep[] {
  if (ccmInfo?.enabled && ccmInfo.isCcmOnly) return SUCCESS_STEPS_CCM_ONLY;
  return SUCCESS_STEPS_FULL;
}

// ─── 7. Payment blocking ────────────────────────────────────────────────

export function isPaymentBlocked(
  orderStatus: string,
  ccmInfo: CcmOrderDisplay | null,
): { blocked: boolean; reason: string | null } {
  if (orderStatus !== "aguardando-confirmacao") {
    return { blocked: false, reason: null };
  }
  if (ccmInfo?.enabled && ccmInfo.hasShortfall) {
    return {
      blocked: true,
      reason: "Estamos confirmando a disponibilidade dos itens. O pagamento será liberado em breve.",
    };
  }
  return { blocked: false, reason: null };
}

// ─── 8. Customer-visible term audit ─────────────────────────────────────

const FORBIDDEN_TERMS = [
  "supplier", "stock_reservation", "payment_lock",
  "supplier_request", "ccm_inventory", "master_product",
  "shortfall", "rpc", "sql",
];

export function containsForbiddenTerms(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_TERMS.some((t) => lower.includes(t));
}
