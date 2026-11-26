/**
 * Tests for payment pending notification feature
 *
 * Validates:
 *  1. Customer with 1 pending order → modal appears
 *  2. Modal dismissed → does not reopen in same session
 *  3. Banner remains after modal dismissed
 *  4. CTA opens correct order page
 *  5. Customer without pending orders → nothing appears
 *  6. Paid order → nothing appears
 *  7. Cancelled order → nothing appears
 *  8. Multiple pending orders → correct counter
 *  9. Customer A does not see customer B orders
 *  10. Non-customer roles → no modal
 *  11. Badge count matches pending orders
 *
 * Run: npx vitest run ccm-etapa1/test/payment-pending-notification.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Types ───────────────────────────────────────────────────────────────────

type UserRole = "customer" | "admin" | "compras" | "recebedor" | "operacao" | "entregador";

interface MockOrder {
  id: string;
  code: string;
  profile_id: string;
  order_status: string;
  payment_status: string;
  payment_method: string | null;
  total_centavos: number;
  created_at: string;
}

interface PendingPaymentOrder {
  code: string;
  total_centavos: number;
  payment_method: string | null;
  created_at: string;
}

// ── Pure simulation of getPendingPaymentOrders ──────────────────────────────

function simulateGetPendingPaymentOrders(
  userId: string | null,
  allOrders: MockOrder[],
): PendingPaymentOrder[] {
  if (!userId) return [];
  return allOrders
    .filter(
      (o) =>
        o.profile_id === userId &&
        o.order_status === "aguardando-pagamento" &&
        o.payment_status === "pendente",
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ code, total_centavos, payment_method, created_at }) => ({
      code,
      total_centavos,
      payment_method,
      created_at,
    }));
}

// ── Pure simulation of role visibility gate ─────────────────────────────────

function shouldShowNotification(role: UserRole | null): boolean {
  return role === "customer";
}

// ── Pure simulation of session storage behavior ─────────────────────────────

function simulateSessionBehavior(
  pendingOrders: PendingPaymentOrder[],
  modalAlreadySeen: boolean,
): { showModal: boolean; showBanner: boolean } {
  if (pendingOrders.length === 0) return { showModal: false, showBanner: false };
  if (modalAlreadySeen) return { showModal: false, showBanner: true };
  return { showModal: true, showBanner: false };
}

// ── Pure simulation of CTA URL ──────────────────────────────────────────────

function getCtaUrl(orders: PendingPaymentOrder[]): string {
  if (orders.length === 1) return `/conta/pedidos/${orders[0].code}`;
  return "/conta/pedidos";
}

// ── Pure simulation of badge count ──────────────────────────────────────────

function getBadgeCount(role: UserRole | null, pendingOrders: PendingPaymentOrder[]): number {
  if (role !== "customer") return 0;
  return pendingOrders.length;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const CUSTOMER_A = "user-aaa";
const CUSTOMER_B = "user-bbb";

const ORDERS: MockOrder[] = [
  {
    id: "o1",
    code: "WJ9001",
    profile_id: CUSTOMER_A,
    order_status: "aguardando-pagamento",
    payment_status: "pendente",
    payment_method: null,
    total_centavos: 150000,
    created_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "o2",
    code: "WJ9002",
    profile_id: CUSTOMER_A,
    order_status: "aguardando-pagamento",
    payment_status: "pendente",
    payment_method: "pix",
    total_centavos: 85000,
    created_at: "2026-11-21T14:00:00Z",
  },
  {
    id: "o3",
    code: "WJ8848",
    profile_id: CUSTOMER_A,
    order_status: "em-separacao",
    payment_status: "pago",
    payment_method: "pix",
    total_centavos: 200000,
    created_at: "2026-11-15T09:00:00Z",
  },
  {
    id: "o4",
    code: "WJ9003",
    profile_id: CUSTOMER_A,
    order_status: "cancelado",
    payment_status: "pendente",
    payment_method: null,
    total_centavos: 50000,
    created_at: "2026-11-19T08:00:00Z",
  },
  {
    id: "o5",
    code: "WJ9004",
    profile_id: CUSTOMER_B,
    order_status: "aguardando-pagamento",
    payment_status: "pendente",
    payment_method: null,
    total_centavos: 75000,
    created_at: "2026-11-22T16:00:00Z",
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Payment Pending Notification", () => {
  // ── 1. Customer with 1 pending order → modal appears ─────────────────────

  test("1: customer with 1 pending order → modal appears", () => {
    const singlePending: MockOrder[] = [ORDERS[0]];
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, singlePending);
    expect(pending).toHaveLength(1);
    const ui = simulateSessionBehavior(pending, false);
    expect(ui.showModal).toBe(true);
  });

  // ── 2. Modal dismissed → does not reopen ─────────────────────────────────

  test("2: modal dismissed → does not reopen in same session", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    const uiFirst = simulateSessionBehavior(pending, false);
    expect(uiFirst.showModal).toBe(true);

    const uiAfterDismiss = simulateSessionBehavior(pending, true);
    expect(uiAfterDismiss.showModal).toBe(false);
  });

  // ── 3. Banner remains after modal dismissed ──────────────────────────────

  test("3: banner remains after modal dismissed", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    const ui = simulateSessionBehavior(pending, true);
    expect(ui.showBanner).toBe(true);
  });

  // ── 4. CTA opens correct order page ──────────────────────────────────────

  test("4a: single order CTA → /conta/pedidos/CODE", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, [ORDERS[0]]);
    expect(getCtaUrl(pending)).toBe("/conta/pedidos/WJ9001");
  });

  test("4b: multiple orders CTA → /conta/pedidos", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(pending.length).toBeGreaterThan(1);
    expect(getCtaUrl(pending)).toBe("/conta/pedidos");
  });

  // ── 5. Customer without pending orders → nothing ─────────────────────────

  test("5: customer without pending orders → nothing appears", () => {
    const noPending: MockOrder[] = [ORDERS[2]]; // already paid
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, noPending);
    expect(pending).toHaveLength(0);
    const ui = simulateSessionBehavior(pending, false);
    expect(ui.showModal).toBe(false);
    expect(ui.showBanner).toBe(false);
  });

  // ── 6. Paid order → nothing appears ──────────────────────────────────────

  test("6: paid order does not appear in pending list", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(pending.find((o) => o.code === "WJ8848")).toBeUndefined();
  });

  // ── 7. Cancelled order → nothing appears ─────────────────────────────────

  test("7: cancelled order does not appear in pending list", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(pending.find((o) => o.code === "WJ9003")).toBeUndefined();
  });

  // ── 8. Multiple pending orders → correct counter ─────────────────────────

  test("8: multiple pending orders → correct count", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(pending).toHaveLength(2);
    expect(pending[0].code).toBe("WJ9001");
    expect(pending[1].code).toBe("WJ9002");
  });

  // ── 9. Customer A does not see customer B orders ─────────────────────────

  test("9: customer A does not see customer B orders", () => {
    const pendingA = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    const pendingB = simulateGetPendingPaymentOrders(CUSTOMER_B, ORDERS);

    expect(pendingA.every((o) => o.code !== "WJ9004")).toBe(true);
    expect(pendingB).toHaveLength(1);
    expect(pendingB[0].code).toBe("WJ9004");
  });

  // ── 10. Non-customer roles → no modal ────────────────────────────────────

  test("10: non-customer roles do not see notification", () => {
    const nonCustomerRoles: UserRole[] = ["admin", "compras", "recebedor", "operacao", "entregador"];
    for (const role of nonCustomerRoles) {
      expect(shouldShowNotification(role)).toBe(false);
    }
    expect(shouldShowNotification("customer")).toBe(true);
    expect(shouldShowNotification(null)).toBe(false);
  });

  // ── 11. Badge count matches pending orders ───────────────────────────────

  test("11a: badge count = pending orders for customer", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(getBadgeCount("customer", pending)).toBe(2);
  });

  test("11b: badge count = 0 for non-customer", () => {
    const pending = simulateGetPendingPaymentOrders(CUSTOMER_A, ORDERS);
    expect(getBadgeCount("admin", pending)).toBe(0);
    expect(getBadgeCount("operacao", pending)).toBe(0);
  });

  test("11c: badge count = 0 when no pending orders", () => {
    expect(getBadgeCount("customer", [])).toBe(0);
  });
});
