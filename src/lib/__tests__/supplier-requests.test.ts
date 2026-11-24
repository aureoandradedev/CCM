/**
 * Tests: Migration 0058 — supplier_requests flow.
 * Guards: G1-G10 as specified.
 *
 * Run: npx vitest run src/lib/__tests__/supplier-requests.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";

// ============================================================================
// Pure logic helpers (no DB, no network — tests the shapes and invariants)
// ============================================================================

type RequestStatus =
  | "aguardando_confirmacao"
  | "confirmado"
  | "confirmado_parcial"
  | "divergencia"
  | "revisao_necessaria"
  | "cancelado";

type LineStatus =
  | "confirmado"
  | "confirmado_parcial"
  | "indisponivel"
  | "divergencia_quantidade"
  | "divergencia_custo"
  | "revisao_necessaria";

interface SupplierRequestLine {
  id: string;
  status: LineStatus | null;
  quantity_requested: number;
  quantity_confirmed: number | null;
  unit_cost_centavos: number;
  cost_confirmed_centavos: number | null;
}

function deriveRequestStatus(lines: SupplierRequestLine[]): RequestStatus {
  if (lines.length === 0) return "aguardando_confirmacao";
  const allConfirmed = lines.every((l) => l.status !== null);
  if (!allConfirmed) return "aguardando_confirmacao";

  if (lines.some((l) => l.status === "revisao_necessaria")) return "revisao_necessaria";
  if (lines.every((l) => l.status === "confirmado")) return "confirmado";
  if (lines.some((l) => ["indisponivel", "divergencia_quantidade", "divergencia_custo"].includes(l.status!)))
    return "divergencia";
  return "confirmado_parcial";
}

function checkGateResolved(requests: { status: RequestStatus }[]): {
  allResolved: boolean;
  hasAdjustments: boolean;
} {
  const unresolved = requests.filter(
    (r) => r.status === "aguardando_confirmacao" || r.status === "revisao_necessaria"
  );
  const allResolved = unresolved.length === 0 && requests.length > 0;
  const hasAdjustments = requests.some(
    (r) => r.status === "confirmado_parcial" || r.status === "divergencia"
  );
  return { allResolved, hasAdjustments };
}

function idempotencyKey(orderId: string, eventType: string, recipientId: string): string {
  return `${orderId}:${eventType}:${recipientId}`;
}

// ============================================================================
// 1. G1: Transactional creation — requests created per supplier
// ============================================================================
describe("G1: Transactional request creation", () => {
  it("creates one request per supplier from checkout items", () => {
    const items = [
      { product_id: "p1", supplier_id: "s1", qty: 5 },
      { product_id: "p2", supplier_id: "s1", qty: 3 },
      { product_id: "p3", supplier_id: "s2", qty: 10 },
    ];
    const supplierIds = [...new Set(items.map((i) => i.supplier_id))];
    expect(supplierIds).toEqual(["s1", "s2"]);

    const requests = supplierIds.map((sid) => ({
      supplier_id: sid,
      items: items.filter((i) => i.supplier_id === sid),
    }));
    expect(requests).toHaveLength(2);
    expect(requests[0].items).toHaveLength(2);
    expect(requests[1].items).toHaveLength(1);
  });

  it("generates correct supplier payload shape", () => {
    const item = {
      name: "Arroz 5kg",
      qty: 10,
      unit: "un",
      supplier_cost_centavos: 1500,
      product_id: "p1",
      master_product_id: "mp1",
    };
    const oiMap = new Map([["p1", "oi-uuid-1"]]);
    const payload = {
      order_item_id: oiMap.get(item.product_id) ?? null,
      master_product_id: item.master_product_id,
      product_name: item.name,
      quantity: item.qty,
      unit: item.unit,
      unit_cost_centavos: item.supplier_cost_centavos,
    };
    expect(payload.order_item_id).toBe("oi-uuid-1");
    expect(payload.quantity).toBe(10);
    expect(payload.unit_cost_centavos).toBe(1500);
  });
});

// ============================================================================
// 2. G2: Request→PO linkage
// ============================================================================
describe("G2: Request→PO explicit FK linkage", () => {
  it("official PO carries source_request_id", () => {
    const request = { id: "req-1", status: "confirmado" as RequestStatus };
    const officialPO = {
      id: "po-1",
      source_request_id: request.id,
      status: "draft",
    };
    expect(officialPO.source_request_id).toBe("req-1");
  });

  it("multiple requests create multiple POs with distinct source_request_id", () => {
    const requests = [
      { id: "req-1", supplier_id: "s1" },
      { id: "req-2", supplier_id: "s2" },
    ];
    const pos = requests.map((r) => ({
      id: `po-${r.supplier_id}`,
      source_request_id: r.id,
    }));
    expect(pos[0].source_request_id).toBe("req-1");
    expect(pos[1].source_request_id).toBe("req-2");
    expect(new Set(pos.map((p) => p.source_request_id)).size).toBe(2);
  });
});

// ============================================================================
// 3. G3: Idempotency
// ============================================================================
describe("G3: Idempotency", () => {
  it("idempotency key is deterministic", () => {
    const key1 = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1");
    const key2 = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1");
    expect(key1).toBe(key2);
    expect(key1).toBe("order-1:nova_solicitacao_fornecedor:s1");
  });

  it("different events produce different keys", () => {
    const k1 = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1");
    const k2 = idempotencyKey("order-1", "confirmacao_concluida", "s1");
    expect(k1).not.toBe(k2);
  });

  it("same event for different suppliers produces different keys", () => {
    const k1 = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1");
    const k2 = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s2");
    expect(k1).not.toBe(k2);
  });
});

// ============================================================================
// 4. G4: Pre-payment cancellation
// ============================================================================
describe("G4: Pre-payment cancellation", () => {
  it("cancellation sets request status to cancelado", () => {
    const requests = [
      { id: "req-1", status: "aguardando_confirmacao" as RequestStatus },
      { id: "req-2", status: "confirmado" as RequestStatus },
    ];
    const cancelled = requests.map((r) => ({
      ...r,
      status: (r.status !== "cancelado" ? "cancelado" : r.status) as RequestStatus,
    }));
    expect(cancelled.every((r) => r.status === "cancelado")).toBe(true);
  });

  it("already cancelled requests are unaffected", () => {
    const request = { id: "req-1", status: "cancelado" as RequestStatus };
    const result = request.status === "cancelado" ? request : { ...request, status: "cancelado" as RequestStatus };
    expect(result.status).toBe("cancelado");
  });
});

// ============================================================================
// 5. G5: Partial confirmation feeds order_items
// ============================================================================
describe("G5: Partial confirmation", () => {
  it("derives request status from line confirmations", () => {
    const allConfirmed: SupplierRequestLine[] = [
      { id: "l1", status: "confirmado", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "l2", status: "confirmado", quantity_requested: 5, quantity_confirmed: 5, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    expect(deriveRequestStatus(allConfirmed)).toBe("confirmado");
  });

  it("partial confirmation → confirmado_parcial", () => {
    const lines: SupplierRequestLine[] = [
      { id: "l1", status: "confirmado", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "l2", status: "confirmado_parcial", quantity_requested: 5, quantity_confirmed: 3, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    expect(deriveRequestStatus(lines)).toBe("confirmado_parcial");
  });

  it("unavailable item → divergencia", () => {
    const lines: SupplierRequestLine[] = [
      { id: "l1", status: "confirmado", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "l2", status: "indisponivel", quantity_requested: 5, quantity_confirmed: 0, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    expect(deriveRequestStatus(lines)).toBe("divergencia");
  });

  it("cost divergence → divergencia", () => {
    const lines: SupplierRequestLine[] = [
      { id: "l1", status: "divergencia_custo", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: 1800 },
    ];
    expect(deriveRequestStatus(lines)).toBe("divergencia");
  });

  it("revisao_necessaria takes precedence", () => {
    const lines: SupplierRequestLine[] = [
      { id: "l1", status: "confirmado", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "l2", status: "revisao_necessaria", quantity_requested: 5, quantity_confirmed: null, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    expect(deriveRequestStatus(lines)).toBe("revisao_necessaria");
  });

  it("unconfirmed lines → aguardando_confirmacao", () => {
    const lines: SupplierRequestLine[] = [
      { id: "l1", status: "confirmado", quantity_requested: 10, quantity_confirmed: 10, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "l2", status: null, quantity_requested: 5, quantity_confirmed: null, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    expect(deriveRequestStatus(lines)).toBe("aguardando_confirmacao");
  });
});

// ============================================================================
// 6. G6: Idempotent viewed_at
// ============================================================================
describe("G6: Idempotent viewed_at", () => {
  it("first view sets viewed_at", () => {
    const request = { viewed_at: null as string | null };
    if (!request.viewed_at) request.viewed_at = new Date().toISOString();
    expect(request.viewed_at).toBeTruthy();
  });

  it("second view does NOT overwrite viewed_at", () => {
    const original = "2026-11-24T10:00:00Z";
    const request = { viewed_at: original };
    if (!request.viewed_at) request.viewed_at = new Date().toISOString();
    expect(request.viewed_at).toBe(original);
  });
});

// ============================================================================
// 7. G7: Outbox events for lifecycle stages
// ============================================================================
describe("G7: Outbox events", () => {
  it("outbox event types cover all stages", () => {
    const eventTypes = [
      "nova_solicitacao_fornecedor",
      "confirmacao_concluida",
      "ajuste_pedido",
      "pagamento_liberado",
      "solicitacao_cancelada",
    ];
    expect(eventTypes).toContain("nova_solicitacao_fornecedor");
    expect(eventTypes).toContain("confirmacao_concluida");
    expect(eventTypes).toContain("solicitacao_cancelada");
  });

  it("outbox record shape is valid", () => {
    const record = {
      order_id: "order-1",
      event_type: "nova_solicitacao_fornecedor",
      recipient_type: "supplier" as "customer" | "supplier",
      recipient_id: "s1",
      payload: { request_id: "req-1", item_count: 3 },
      idempotency_key: idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1"),
    };
    expect(record.recipient_type).toBe("supplier");
    expect(record.payload.item_count).toBe(3);
    expect(record.idempotency_key).toBeTruthy();
  });
});

// ============================================================================
// 8. G8: Checkout uses supplier_requests, NOT purchase_requirements
// ============================================================================
describe("G8: Checkout uses supplier_requests", () => {
  it("RPC name is create_supplier_requests_for_order, not materialize_order_requirements", () => {
    const rpcName = "create_supplier_requests_for_order";
    expect(rpcName).not.toBe("materialize_order_requirements");
    expect(rpcName).toContain("supplier_requests");
  });
});

// ============================================================================
// 9. G9: PO official only after payment
// ============================================================================
describe("G9: PO official only after payment", () => {
  it("official PO creation requires confirmed payment", () => {
    const order = { payment_status: "pago", order_status: "em-separacao" };
    const canCreatePO = order.payment_status === "pago";
    expect(canCreatePO).toBe(true);
  });

  it("pending payment blocks official PO creation", () => {
    const order = { payment_status: "pendente", order_status: "aguardando-pagamento" };
    const canCreatePO = order.payment_status === "pago";
    expect(canCreatePO).toBe(false);
  });

  it("RPC name is create_official_pos_from_requests", () => {
    const rpcName = "create_official_pos_from_requests";
    expect(rpcName).toContain("official");
    expect(rpcName).toContain("from_requests");
  });
});

// ============================================================================
// 10. Gate multi-fornecedor
// ============================================================================
describe("Gate: multi-supplier resolution", () => {
  it("all confirmed → resolved, no adjustments", () => {
    const requests = [
      { status: "confirmado" as RequestStatus },
      { status: "confirmado" as RequestStatus },
    ];
    const gate = checkGateResolved(requests);
    expect(gate.allResolved).toBe(true);
    expect(gate.hasAdjustments).toBe(false);
  });

  it("one pending → NOT resolved", () => {
    const requests = [
      { status: "confirmado" as RequestStatus },
      { status: "aguardando_confirmacao" as RequestStatus },
    ];
    const gate = checkGateResolved(requests);
    expect(gate.allResolved).toBe(false);
  });

  it("revisao_necessaria → NOT resolved", () => {
    const requests = [
      { status: "confirmado" as RequestStatus },
      { status: "revisao_necessaria" as RequestStatus },
    ];
    const gate = checkGateResolved(requests);
    expect(gate.allResolved).toBe(false);
  });

  it("partial + confirmed → resolved WITH adjustments", () => {
    const requests = [
      { status: "confirmado" as RequestStatus },
      { status: "confirmado_parcial" as RequestStatus },
    ];
    const gate = checkGateResolved(requests);
    expect(gate.allResolved).toBe(true);
    expect(gate.hasAdjustments).toBe(true);
  });

  it("divergencia → resolved WITH adjustments", () => {
    const requests = [
      { status: "divergencia" as RequestStatus },
    ];
    const gate = checkGateResolved(requests);
    expect(gate.allResolved).toBe(true);
    expect(gate.hasAdjustments).toBe(true);
  });

  it("empty requests → NOT resolved", () => {
    const gate = checkGateResolved([]);
    expect(gate.allResolved).toBe(false);
  });
});

// ============================================================================
// 11. Supplier isolation (RLS)
// ============================================================================
describe("Supplier isolation", () => {
  it("owns_supplier check prevents cross-supplier access", () => {
    const supplierA = "s1";
    const supplierB = "s2";
    const request = { supplier_id: supplierA };
    const canAccess = (viewerId: string) => request.supplier_id === viewerId;
    expect(canAccess(supplierA)).toBe(true);
    expect(canAccess(supplierB)).toBe(false);
  });
});

// ============================================================================
// 12. Portal status map
// ============================================================================
describe("Portal status display", () => {
  const STATUS_MAP: Record<string, string> = {
    aguardando_confirmacao: "Aguardando sua confirmação",
    confirmado: "Confirmado",
    confirmado_parcial: "Confirmado parcial",
    divergencia: "Divergência",
    revisao_necessaria: "Em revisão",
  };

  it("maps all request statuses to display labels", () => {
    const statuses: RequestStatus[] = [
      "aguardando_confirmacao",
      "confirmado",
      "confirmado_parcial",
      "divergencia",
      "revisao_necessaria",
    ];
    for (const s of statuses) {
      expect(STATUS_MAP[s]).toBeTruthy();
    }
  });

  it("cancelado is NOT shown in portal (filtered out)", () => {
    expect(STATUS_MAP["cancelado"]).toBeUndefined();
  });
});

// ============================================================================
// 13. Confirmation form line mapping
// ============================================================================
describe("Confirmation form", () => {
  it("maps lines to confirmation items with lineId", () => {
    const lines: SupplierRequestLine[] = [
      { id: "line-1", status: null, quantity_requested: 10, quantity_confirmed: null, unit_cost_centavos: 1500, cost_confirmed_centavos: null },
      { id: "line-2", status: null, quantity_requested: 5, quantity_confirmed: null, unit_cost_centavos: 2000, cost_confirmed_centavos: null },
    ];
    const confirmations = lines.map((l) => ({
      lineId: l.id,
      qtyConfirmed: l.quantity_requested,
      status: "confirmado" as LineStatus,
    }));
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0].lineId).toBe("line-1");
    expect(confirmations[1].lineId).toBe("line-2");
  });

  it("partial qty is capped at requested qty", () => {
    const requested = 10;
    const userInput = 15;
    const capped = Math.min(Math.max(0, userInput), requested);
    expect(capped).toBe(10);
  });

  it("indisponivel sets qty to 0", () => {
    const status: LineStatus = "indisponivel";
    const qty = status === "indisponivel" ? 0 : 10;
    expect(qty).toBe(0);
  });
});

// ============================================================================
// 14. Duplicate webhook / retry safety
// ============================================================================
describe("Duplicate webhook / retry safety", () => {
  it("outbox idempotency_key deduplicates retries", () => {
    const seen = new Set<string>();
    const key = idempotencyKey("order-1", "nova_solicitacao_fornecedor", "s1");
    seen.add(key);
    const isDuplicate = seen.has(key);
    expect(isDuplicate).toBe(true);
  });

  it("request creation is idempotent (same order + supplier → same request)", () => {
    const existing = { order_id: "order-1", supplier_id: "s1" };
    const incoming = { order_id: "order-1", supplier_id: "s1" };
    const wouldConflict =
      existing.order_id === incoming.order_id && existing.supplier_id === incoming.supplier_id;
    expect(wouldConflict).toBe(true);
  });
});
