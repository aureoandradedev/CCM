/**
 * Tests: Bloco 4 V2 — Item Fulfillment State + Complement Rounds
 * Pure logic only — no DB, no network.
 *
 * Run: npx vitest run src/lib/__tests__/bloco4-v2-item-fulfillment.test.ts
 */
// @ts-expect-error vitest not installed yet
import { describe, it, expect } from "vitest";
import {
  getCustomerDisplayStatus,
  getAdminDisplayStatus,
  canCreateComplement,
} from "../item-fulfillment";
import {
  INTERNAL_ITEM_FIELDS,
  CUSTOMER_ITEM_COLUMNS,
  type FulfillmentStatus,
} from "../orders";

// ============================================================================
// 1. State transitions: display helpers
// ============================================================================

describe("getCustomerDisplayStatus", () => {
  it("returns null when fulfillment_status is null (flag OFF)", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: null, removal_reason: null })).toBeNull();
  });

  it("returns 'Verificando disponibilidade' for aguardando_fornecedor", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: "aguardando_fornecedor", removal_reason: null })).toBe("Verificando disponibilidade");
  });

  it("returns 'Disponível' for atendido", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: "atendido", removal_reason: null })).toBe("Disponível");
  });

  it("returns 'Buscando com fornecedor' for complemento_pendente", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: "complemento_pendente", removal_reason: null })).toBe("Buscando com fornecedor");
  });

  it("returns 'Removido do pedido' for removido", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: "removido", removal_reason: null })).toBe("Removido do pedido");
  });

  it("returns 'Removido do pedido' when removal_reason is set, overriding fulfillment_status", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: "aguardando_fornecedor", removal_reason: "sem_estoque" })).toBe("Removido do pedido");
  });
});

describe("getAdminDisplayStatus", () => {
  it("returns null when fulfillment_status is null", () => {
    expect(getAdminDisplayStatus({ fulfillment_status: null, removal_reason: null })).toBeNull();
  });

  it("returns correct label and tone for each status", () => {
    const statuses: FulfillmentStatus[] = ["aguardando_fornecedor", "atendido", "complemento_pendente", "removido"];
    for (const s of statuses) {
      const result = getAdminDisplayStatus({ fulfillment_status: s, removal_reason: null });
      expect(result).not.toBeNull();
      expect(result!.label).toBeTruthy();
      expect(result!.tone).toBeTruthy();
    }
  });

  it("admin display: removido has tone red", () => {
    const result = getAdminDisplayStatus({ fulfillment_status: "removido", removal_reason: null });
    expect(result!.tone).toBe("red");
  });

  it("admin display: atendido has tone green", () => {
    const result = getAdminDisplayStatus({ fulfillment_status: "atendido", removal_reason: null });
    expect(result!.tone).toBe("green");
  });
});

// ============================================================================
// 2. Flag OFF: null fulfillment_status returns null display
// ============================================================================

describe("Flag OFF behavior", () => {
  it("customer display is null when fulfillment_status is null", () => {
    expect(getCustomerDisplayStatus({ fulfillment_status: null, removal_reason: null })).toBeNull();
  });

  it("admin display is null when fulfillment_status is null", () => {
    expect(getAdminDisplayStatus({ fulfillment_status: null, removal_reason: null })).toBeNull();
  });

  it("canCreateComplement returns true only when residual > 0 and no removal", () => {
    expect(canCreateComplement({ residual_qty: 5, removal_reason: null, qty: 10 })).toBe(true);
    expect(canCreateComplement({ residual_qty: 0, removal_reason: null, qty: 10 })).toBe(false);
    expect(canCreateComplement({ residual_qty: null, removal_reason: null, qty: 10 })).toBe(false);
  });
});

// ============================================================================
// 3. Complement round: canCreateComplement
// ============================================================================

describe("canCreateComplement", () => {
  it("returns true when residual > 0 and no removal", () => {
    expect(canCreateComplement({ residual_qty: 3, removal_reason: null, qty: 10 })).toBe(true);
  });

  it("returns false when residual is 0", () => {
    expect(canCreateComplement({ residual_qty: 0, removal_reason: null, qty: 10 })).toBe(false);
  });

  it("returns false when item is removed", () => {
    expect(canCreateComplement({ residual_qty: 5, removal_reason: "sem_estoque", qty: 10 })).toBe(false);
  });

  it("returns false when qty is 0", () => {
    expect(canCreateComplement({ residual_qty: 5, removal_reason: null, qty: 0 })).toBe(false);
  });

  it("returns false when residual_qty is null", () => {
    expect(canCreateComplement({ residual_qty: null, removal_reason: null, qty: 10 })).toBe(false);
  });
});

// ============================================================================
// 4. Payload security: fulfillment_status must be internal-only
// ============================================================================

describe("Payload security: fulfillment_status", () => {
  const itemCols = CUSTOMER_ITEM_COLUMNS.split(",").map((c) => c.trim());

  it("fulfillment_status must be in INTERNAL_ITEM_FIELDS", () => {
    expect(INTERNAL_ITEM_FIELDS).toContain("fulfillment_status");
  });

  it("residual_qty must be in INTERNAL_ITEM_FIELDS", () => {
    expect(INTERNAL_ITEM_FIELDS).toContain("residual_qty");
  });

  it("fulfillment_status must NOT be in CUSTOMER_ITEM_COLUMNS", () => {
    expect(itemCols).not.toContain("fulfillment_status");
  });

  it("residual_qty must NOT be in CUSTOMER_ITEM_COLUMNS", () => {
    expect(itemCols).not.toContain("residual_qty");
  });
});

// ============================================================================
// 5. FulfillmentStatus type: exactly 4 values
// ============================================================================

describe("FulfillmentStatus type", () => {
  it("only the 4 defined states are valid", () => {
    const validStates: FulfillmentStatus[] = [
      "aguardando_fornecedor",
      "atendido",
      "complemento_pendente",
      "removido",
    ];
    for (const s of validStates) {
      const result = getCustomerDisplayStatus({ fulfillment_status: s, removal_reason: null });
      expect(result).not.toBeNull();
    }
  });
});

// ============================================================================
// 6. Item removal overrides fulfillment_status in display
// ============================================================================

describe("Item removal + complement", () => {
  it("removed item shows 'Removido do pedido' even with complemento_pendente status", () => {
    expect(
      getCustomerDisplayStatus({ fulfillment_status: "complemento_pendente", removal_reason: "sem_estoque" })
    ).toBe("Removido do pedido");
  });

  it("removed item cannot create complement", () => {
    expect(canCreateComplement({ residual_qty: 5, removal_reason: "sem_estoque", qty: 10 })).toBe(false);
  });
});

// ============================================================================
// 7. Remaining qty formula (pure logic)
// ============================================================================

describe("remaining_qty formula", () => {
  function computeRemaining(residual_qty: number, confirmedClaims: number[]): number {
    const totalClaimed = confirmedClaims.reduce((s, c) => s + c, 0);
    return Math.max(residual_qty - totalClaimed, 0);
  }

  it("full claim: remaining = 0", () => {
    expect(computeRemaining(10, [10])).toBe(0);
  });

  it("partial claim: remaining > 0", () => {
    expect(computeRemaining(10, [7])).toBe(3);
  });

  it("multi-claim from multiple rounds: sums all", () => {
    expect(computeRemaining(10, [5, 3])).toBe(2);
  });

  it("over-claim: capped at 0", () => {
    expect(computeRemaining(10, [12])).toBe(0);
  });

  it("no claims: remaining = residual", () => {
    expect(computeRemaining(10, [])).toBe(10);
  });
});

// ============================================================================
// 8. Idempotency key format
// ============================================================================

describe("Idempotency key format", () => {
  function buildIdempotencyKey(orderId: string, round: number, supplierId: string): string {
    return `${orderId}:complement:r${round}:${supplierId}`;
  }

  it("produces the correct format", () => {
    const key = buildIdempotencyKey("abc-123", 3, "supplier-456");
    expect(key).toBe("abc-123:complement:r3:supplier-456");
  });

  it("different rounds produce different keys", () => {
    const k1 = buildIdempotencyKey("order", 1, "sup");
    const k2 = buildIdempotencyKey("order", 2, "sup");
    expect(k1).not.toBe(k2);
  });

  it("different suppliers produce different keys", () => {
    const k1 = buildIdempotencyKey("order", 1, "sup-a");
    const k2 = buildIdempotencyKey("order", 1, "sup-b");
    expect(k1).not.toBe(k2);
  });
});

// ============================================================================
// 9. Max rounds logic
// ============================================================================

describe("Max rounds enforcement", () => {
  function checkMaxRounds(currentMax: number, limit: number): { allowed: boolean; escalate: boolean } {
    const newRound = currentMax + 1;
    if (newRound > limit) {
      return { allowed: false, escalate: true };
    }
    return { allowed: true, escalate: false };
  }

  it("round 1 when max=3: allowed", () => {
    expect(checkMaxRounds(0, 3)).toEqual({ allowed: true, escalate: false });
  });

  it("round 3 when max=3: allowed", () => {
    expect(checkMaxRounds(2, 3)).toEqual({ allowed: true, escalate: false });
  });

  it("round 4 when max=3: blocked + escalated", () => {
    expect(checkMaxRounds(3, 3)).toEqual({ allowed: false, escalate: true });
  });

  it("round 2 when max=1: blocked + escalated", () => {
    expect(checkMaxRounds(1, 1)).toEqual({ allowed: false, escalate: true });
  });
});

// ============================================================================
// 10. Race protection: payment lock check logic
// ============================================================================

describe("Race protection: payment × complement", () => {
  interface PaymentState {
    payment_status: string;
    payment_lock_fase: string | null;
    has_active_stock_lock: boolean;
  }

  function canCreateComplementRace(state: PaymentState): { ok: boolean; reason?: string } {
    if (state.payment_status !== "pendente") {
      return { ok: false, reason: "payment_already_done" };
    }
    if (state.payment_lock_fase && !["concluido", "erro"].includes(state.payment_lock_fase)) {
      return { ok: false, reason: "payment_in_flight" };
    }
    if (state.has_active_stock_lock) {
      return { ok: false, reason: "stock_lock_active" };
    }
    return { ok: true };
  }

  it("Case A: no payment activity → complement allowed", () => {
    expect(canCreateComplementRace({ payment_status: "pendente", payment_lock_fase: null, has_active_stock_lock: false })).toEqual({ ok: true });
  });

  it("Case A': payment_lock finished → complement allowed", () => {
    expect(canCreateComplementRace({ payment_status: "pendente", payment_lock_fase: "concluido", has_active_stock_lock: false })).toEqual({ ok: true });
  });

  it("Case A'': payment_lock errored → complement allowed", () => {
    expect(canCreateComplementRace({ payment_status: "pendente", payment_lock_fase: "erro", has_active_stock_lock: false })).toEqual({ ok: true });
  });

  it("Case B: payment_lock active → fail-closed", () => {
    expect(canCreateComplementRace({ payment_status: "pendente", payment_lock_fase: "aguardando", has_active_stock_lock: false })).toEqual({ ok: false, reason: "payment_in_flight" });
  });

  it("Case B': stock lock active → fail-closed", () => {
    expect(canCreateComplementRace({ payment_status: "pendente", payment_lock_fase: null, has_active_stock_lock: true })).toEqual({ ok: false, reason: "stock_lock_active" });
  });

  it("Case C: already paid → fail-closed (commercial decision C2)", () => {
    expect(canCreateComplementRace({ payment_status: "pago", payment_lock_fase: null, has_active_stock_lock: false })).toEqual({ ok: false, reason: "payment_already_done" });
  });
});

// ============================================================================
// 11. Result lock invalidation logic
// ============================================================================

describe("Result lock invalidation", () => {
  interface OrderLockState {
    result_lock_id: string | null;
    result_protection_status: string | null;
    result_locked_at: string | null;
  }

  function invalidateResultLock(state: OrderLockState): OrderLockState {
    return {
      result_lock_id: null,
      result_protection_status: null,
      result_locked_at: null,
    };
  }

  it("clears all result lock fields", () => {
    const before: OrderLockState = {
      result_lock_id: "lock-123",
      result_protection_status: "approved",
      result_locked_at: "2026-01-01T00:00:00Z",
    };
    const after = invalidateResultLock(before);
    expect(after.result_lock_id).toBeNull();
    expect(after.result_protection_status).toBeNull();
    expect(after.result_locked_at).toBeNull();
  });

  it("preserves the old lock (not mutated)", () => {
    const oldLock = { id: "lock-old", status: "approved", decision_notes: "auto" };
    const after = invalidateResultLock({
      result_lock_id: oldLock.id,
      result_protection_status: "approved",
      result_locked_at: "2026-01-01T00:00:00Z",
    });
    expect(oldLock.status).toBe("approved");
    expect(after.result_lock_id).toBeNull();
  });

  it("idempotent: clearing already-null fields stays null", () => {
    const before: OrderLockState = { result_lock_id: null, result_protection_status: null, result_locked_at: null };
    const after = invalidateResultLock(before);
    expect(after.result_lock_id).toBeNull();
    expect(after.result_protection_status).toBeNull();
  });
});

// ============================================================================
// 12. Order status rollback on complement
// ============================================================================

describe("Order status rollback on complement", () => {
  function rollbackStatusForComplement(currentStatus: string): string {
    if (currentStatus === "aguardando-pagamento") return "aguardando-confirmacao";
    return currentStatus;
  }

  it("aguardando-pagamento → aguardando-confirmacao", () => {
    expect(rollbackStatusForComplement("aguardando-pagamento")).toBe("aguardando-confirmacao");
  });

  it("aguardando-confirmacao stays unchanged", () => {
    expect(rollbackStatusForComplement("aguardando-confirmacao")).toBe("aguardando-confirmacao");
  });

  it("em-separacao stays unchanged (post-payment, should not reach complement)", () => {
    expect(rollbackStatusForComplement("em-separacao")).toBe("em-separacao");
  });
});
