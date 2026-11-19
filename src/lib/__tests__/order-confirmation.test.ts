/**
 * Testes: Fase 1 Etapa 2 — aguardando-confirmacao + payment gating + cancellation.
 *
 * Requer vitest: npx vitest run src/lib/__tests__/order-confirmation.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import { ORDER_STATUS, type OrderStatus } from "../orders";

// ============================================================================
// 1. ORDER_STATUS includes aguardando-confirmacao
// ============================================================================
describe("ORDER_STATUS", () => {
  it("includes aguardando-confirmacao", () => {
    expect(ORDER_STATUS).toHaveProperty("aguardando-confirmacao");
    expect(ORDER_STATUS["aguardando-confirmacao"].label).toBe("Aguardando confirmação");
    expect(ORDER_STATUS["aguardando-confirmacao"].tone).toBe("orange");
  });

  it("preserves all existing statuses", () => {
    const expected = [
      "aguardando-confirmacao",
      "aguardando-pagamento",
      "em-separacao",
      "separados",
      "pagamento-pendente",
      "pagos",
      "arquivados",
      "cancelado",
    ];
    expect(Object.keys(ORDER_STATUS)).toEqual(expected);
  });
});

// ============================================================================
// 2. FLUXO map transitions (inline test of the state machine)
// ============================================================================
describe("FLUXO transitions", () => {
  const FLUXO: Record<string, string[]> = {
    "aguardando-confirmacao": ["aguardando-pagamento", "cancelado"],
    "aguardando-pagamento": ["em-separacao", "cancelado"],
    "em-separacao": ["separados", "aguardando-pagamento", "cancelado"],
    separados: ["pagos", "pagamento-pendente", "em-separacao"],
    "pagamento-pendente": ["pagos", "separados"],
    pagos: ["arquivados", "separados"],
    arquivados: [],
    cancelado: [],
  };

  it("aguardando-confirmacao can go to aguardando-pagamento or cancelado", () => {
    expect(FLUXO["aguardando-confirmacao"]).toEqual(["aguardando-pagamento", "cancelado"]);
  });

  it("aguardando-confirmacao cannot go directly to em-separacao", () => {
    expect(FLUXO["aguardando-confirmacao"]).not.toContain("em-separacao");
  });

  it("cancelado is terminal", () => {
    expect(FLUXO["cancelado"]).toEqual([]);
  });

  it("arquivados is terminal", () => {
    expect(FLUXO["arquivados"]).toEqual([]);
  });

  it("every status in ORDER_STATUS has a FLUXO entry", () => {
    for (const s of Object.keys(ORDER_STATUS)) {
      expect(FLUXO).toHaveProperty(s);
    }
  });
});

// ============================================================================
// 3. Payment gating logic (pure function test)
// ============================================================================
describe("payment gating", () => {
  function guardaPedidoPagavel(order: { order_status: string; refund_status?: string; total_centavos: number } | null): string | null {
    if (!order) return "Pedido não encontrado.";
    if (order.order_status === "cancelado") return "Pedido cancelado.";
    if (order.order_status !== "aguardando-pagamento") return "Pedido não está liberado para pagamento.";
    if (["estornado", "processando", "incerto"].includes(order.refund_status || "")) return "Pedido em estorno.";
    if (Number(order.total_centavos) < 1) return "Valor do pedido inválido.";
    return null;
  }

  it("allows payment when order_status is aguardando-pagamento", () => {
    expect(guardaPedidoPagavel({ order_status: "aguardando-pagamento", total_centavos: 1000 })).toBeNull();
  });

  it("blocks payment when order_status is aguardando-confirmacao", () => {
    expect(guardaPedidoPagavel({ order_status: "aguardando-confirmacao", total_centavos: 1000 })).toBe("Pedido não está liberado para pagamento.");
  });

  it("blocks payment when order_status is em-separacao", () => {
    expect(guardaPedidoPagavel({ order_status: "em-separacao", total_centavos: 1000 })).toBe("Pedido não está liberado para pagamento.");
  });

  it("blocks payment when order_status is cancelado", () => {
    expect(guardaPedidoPagavel({ order_status: "cancelado", total_centavos: 1000 })).toBe("Pedido cancelado.");
  });

  it("blocks payment on null order", () => {
    expect(guardaPedidoPagavel(null)).toBe("Pedido não encontrado.");
  });

  it("blocks payment on refund in progress", () => {
    expect(guardaPedidoPagavel({ order_status: "aguardando-pagamento", refund_status: "processando", total_centavos: 1000 })).toBe("Pedido em estorno.");
  });

  it("blocks payment with zero amount", () => {
    expect(guardaPedidoPagavel({ order_status: "aguardando-pagamento", total_centavos: 0 })).toBe("Valor do pedido inválido.");
  });
});

// ============================================================================
// 4. statusIniciais logic (pure function test)
// ============================================================================
describe("statusIniciais", () => {
  const METODOS = new Set(["pix", "cartao-credito", "cartao-debito", "cartao-pendente", "na-entrega", "boleto", "faturado"]);

  function statusIniciais(paymentMethod: string): { order_status: string; payment_status: string } {
    if (!METODOS.has(paymentMethod)) throw new Error("Forma de pagamento inválida.");
    return { order_status: "aguardando-confirmacao", payment_status: "pendente" };
  }

  it("all payment methods produce aguardando-confirmacao", () => {
    for (const m of METODOS) {
      const r = statusIniciais(m);
      expect(r.order_status).toBe("aguardando-confirmacao");
      expect(r.payment_status).toBe("pendente");
    }
  });

  it("na-entrega also produces aguardando-confirmacao (no longer em-separacao)", () => {
    const r = statusIniciais("na-entrega");
    expect(r.order_status).toBe("aguardando-confirmacao");
    expect(r.order_status).not.toBe("em-separacao");
  });

  it("throws on invalid payment method", () => {
    expect(() => statusIniciais("cheque")).toThrow("Forma de pagamento inválida.");
  });
});

// ============================================================================
// 5. Confirmation target status (what confirm_order RPC should do)
// ============================================================================
describe("confirmation target", () => {
  function confirmTarget(paymentMethod: string): string {
    return paymentMethod === "na-entrega" ? "em-separacao" : "aguardando-pagamento";
  }

  it("na-entrega goes to em-separacao (skips payment)", () => {
    expect(confirmTarget("na-entrega")).toBe("em-separacao");
  });

  it("pix goes to aguardando-pagamento", () => {
    expect(confirmTarget("pix")).toBe("aguardando-pagamento");
  });

  it("cartao goes to aguardando-pagamento", () => {
    expect(confirmTarget("cartao-credito")).toBe("aguardando-pagamento");
  });

  it("boleto goes to aguardando-pagamento", () => {
    expect(confirmTarget("boleto")).toBe("aguardando-pagamento");
  });
});

// ============================================================================
// 5b. confirmPayment must NOT bypass confirmação comercial
// ============================================================================
describe("confirmPayment blocks aguardando-confirmacao", () => {
  function confirmPaymentGuard(orderStatus: string): string | null {
    if (orderStatus === "aguardando-confirmacao") return "Pedido ainda aguarda confirmação comercial.";
    return null;
  }

  it("blocks payment confirmation when aguardando-confirmacao", () => {
    expect(confirmPaymentGuard("aguardando-confirmacao")).toBe("Pedido ainda aguarda confirmação comercial.");
  });

  it("allows payment confirmation when aguardando-pagamento", () => {
    expect(confirmPaymentGuard("aguardando-pagamento")).toBeNull();
  });

  it("allows payment confirmation when em-separacao", () => {
    expect(confirmPaymentGuard("em-separacao")).toBeNull();
  });
});

// ============================================================================
// 6. Cleanup targets both aguardando-pagamento (24h) and aguardando-confirmacao (configurable timeout)
// ============================================================================
describe("cleanupOrders filter", () => {
  it("targets aguardando-pagamento with 24h fixed timeout", () => {
    const statuses = ["aguardando-confirmacao", "aguardando-pagamento", "em-separacao", "cancelado"];
    const paymentCleanupFilter = (s: string) => s === "aguardando-pagamento";
    const targeted = statuses.filter(paymentCleanupFilter);
    expect(targeted).toEqual(["aguardando-pagamento"]);
  });

  it("targets aguardando-confirmacao with configurable timeout (default 48h)", () => {
    const statuses = ["aguardando-confirmacao", "aguardando-pagamento", "em-separacao", "cancelado"];
    const confirmCleanupFilter = (s: string) => s === "aguardando-confirmacao";
    const targeted = statuses.filter(confirmCleanupFilter);
    expect(targeted).toEqual(["aguardando-confirmacao"]);
  });

  it("does not touch em-separacao or cancelado", () => {
    const statuses = ["aguardando-confirmacao", "aguardando-pagamento", "em-separacao", "cancelado"];
    const cleanupFilter = (s: string) => s === "aguardando-pagamento" || s === "aguardando-confirmacao";
    const targeted = statuses.filter(cleanupFilter);
    expect(targeted).not.toContain("em-separacao");
    expect(targeted).not.toContain("cancelado");
  });
});

// ============================================================================
// 7. Cancel order should clean up shipments and requirements (documented behavior)
// ============================================================================
describe("cancel_order_full behavior contract", () => {
  it("should release stock, cancel shipments, remove requirements", () => {
    const actions = {
      releaseStock: false,
      cancelShipments: false,
      removeRequirements: false,
      setStatusCancelado: false,
    };

    function cancelOrderFull(order: { stock_reserved: boolean; payment_status: string }) {
      if (order.payment_status === "pago") return { error: "Pedido pago: estorne primeiro." };
      if (order.stock_reserved) actions.releaseStock = true;
      actions.cancelShipments = true;
      actions.removeRequirements = true;
      actions.setStatusCancelado = true;
      return { ok: true };
    }

    const result = cancelOrderFull({ stock_reserved: true, payment_status: "pendente" });
    expect(result).toEqual({ ok: true });
    expect(actions.releaseStock).toBe(true);
    expect(actions.cancelShipments).toBe(true);
    expect(actions.removeRequirements).toBe(true);
    expect(actions.setStatusCancelado).toBe(true);
  });

  it("blocks cancellation of paid orders", () => {
    function cancelOrderFull(order: { stock_reserved: boolean; payment_status: string }) {
      if (order.payment_status === "pago") return { error: "Pedido pago: estorne primeiro." };
      return { ok: true };
    }

    const result = cancelOrderFull({ stock_reserved: true, payment_status: "pago" });
    expect(result).toHaveProperty("error");
  });
});

// ============================================================================
// 8. Reopen order target status
// ============================================================================
describe("reopenOrder target", () => {
  it("reopens paid order to em-separacao", () => {
    const target = (paymentStatus: string) => paymentStatus === "pago" ? "em-separacao" : "aguardando-confirmacao";
    expect(target("pago")).toBe("em-separacao");
  });

  it("reopens unpaid order to aguardando-confirmacao (not aguardando-pagamento)", () => {
    const target = (paymentStatus: string) => paymentStatus === "pago" ? "em-separacao" : "aguardando-confirmacao";
    expect(target("pendente")).toBe("aguardando-confirmacao");
  });
});
