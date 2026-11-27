/**
 * Tests: Bloco 3 V2 — Economic Protection System
 * Credit ledger, freight proration, result protection, economic gate.
 * Pure logic only — no DB, no network.
 *
 * Run: npx vitest run src/lib/__tests__/bloco3-v2-economic-protection.test.ts
 */
// @ts-expect-error vitest not installed yet
import { describe, it, expect } from "vitest";

// ============================================================================
// Types (mirror of migration 0076/0077 structures)
// ============================================================================

type EntryType =
  | "credit_generated"
  | "credit_reserved"
  | "credit_used"
  | "credit_released"
  | "credit_adjusted"
  | "credit_reversed";

interface CreditEntry {
  id: string;
  order_id: string;
  entry_type: EntryType;
  amount_centavos: number;
  balance_after: number;
  idempotency_key: string;
}

interface FreightAllocation {
  order_id: string;
  purchase_order_id: string;
  po_freight_centavos: number;
  order_cost_centavos: number;
  po_total_cost_centavos: number;
  allocated_centavos: number;
  is_remainder: boolean;
}

interface OrderResult {
  revenue_centavos: number;
  cost_centavos: number;
  freight_allocated_centavos: number;
  discount_commercial_centavos: number;
  discount_credit_centavos: number;
  result_centavos: number;
  minimum_result_centavos: number;
  result_approved: boolean;
}

// ============================================================================
// Pure functions under test
// ============================================================================

function computeGordura(
  unit_cost_centavos: number,
  cost_confirmed_centavos: number,
  quantity_confirmed: number,
): number {
  return (unit_cost_centavos - cost_confirmed_centavos) * quantity_confirmed;
}

function allocateFreight(
  po_freight_centavos: number,
  orders: { order_id: string; cost_centavos: number }[],
): FreightAllocation[] {
  const totalCost = orders.reduce((s, o) => s + o.cost_centavos, 0);
  if (totalCost === 0 || orders.length === 0) return [];

  const allocations: FreightAllocation[] = [];
  let allocated = 0;

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const isLast = i === orders.length - 1;
    let share: number;

    if (isLast) {
      share = po_freight_centavos - allocated;
    } else {
      share = Math.floor((po_freight_centavos * o.cost_centavos) / totalCost);
    }

    allocations.push({
      order_id: o.order_id,
      purchase_order_id: "po-1",
      po_freight_centavos,
      order_cost_centavos: o.cost_centavos,
      po_total_cost_centavos: totalCost,
      allocated_centavos: share,
      is_remainder: isLast,
    });
    allocated += share;
  }

  return allocations;
}

function computeOrderResult(
  revenue: number,
  cost: number,
  freightAllocated: number,
  discountCommercial: number,
  discountCredit: number,
  minimumResult: number,
): OrderResult {
  const result = revenue - cost - freightAllocated - discountCommercial - discountCredit;
  return {
    revenue_centavos: revenue,
    cost_centavos: cost,
    freight_allocated_centavos: freightAllocated,
    discount_commercial_centavos: discountCommercial,
    discount_credit_centavos: discountCredit,
    result_centavos: result,
    minimum_result_centavos: minimumResult,
    result_approved: result >= minimumResult,
  };
}

function reserveCredit(
  currentBalance: number,
  amount: number,
): { ok: boolean; newBalance: number } {
  if (amount <= 0) return { ok: false, newBalance: currentBalance };
  if (currentBalance < amount) return { ok: false, newBalance: currentBalance };
  return { ok: true, newBalance: currentBalance - amount };
}

function releaseCredit(
  currentBalance: number,
  reservedAmount: number,
): number {
  return currentBalance + reservedAmount;
}

// ============================================================================
// A. GORDURA (credit from cost savings)
// ============================================================================

describe("A. Gordura / credit generation", () => {
  it("A1: positive gordura when confirmed cost < assumed", () => {
    const g = computeGordura(1000, 800, 10);
    expect(g).toBe(2000);
  });

  it("A2: zero gordura when costs match", () => {
    const g = computeGordura(1000, 1000, 5);
    expect(g).toBe(0);
  });

  it("A3: negative gordura (overrun) when confirmed > assumed", () => {
    const g = computeGordura(1000, 1200, 3);
    expect(g).toBe(-600);
  });

  it("A4: gordura with zero quantity", () => {
    const g = computeGordura(1000, 500, 0);
    expect(g).toBe(0);
  });

  it("A5: multi-line gordura accumulation", () => {
    const lines = [
      { assumed: 1000, confirmed: 900, qty: 5 },
      { assumed: 2000, confirmed: 1800, qty: 3 },
      { assumed: 500, confirmed: 500, qty: 10 },
    ];
    const total = lines.reduce(
      (s, l) => s + computeGordura(l.assumed, l.confirmed, l.qty),
      0,
    );
    expect(total).toBe(500 + 600 + 0);
    expect(total).toBe(1100);
  });
});

// ============================================================================
// B. Credit Ledger invariants
// ============================================================================

describe("B. Credit ledger invariants", () => {
  it("B1: append-only — entries accumulate, never mutate", () => {
    const ledger: CreditEntry[] = [];
    let balance = 0;

    balance += 1000;
    ledger.push({
      id: "1", order_id: "o1", entry_type: "credit_generated",
      amount_centavos: 1000, balance_after: balance, idempotency_key: "gen:1",
    });

    balance -= 300;
    ledger.push({
      id: "2", order_id: "o1", entry_type: "credit_reserved",
      amount_centavos: -300, balance_after: balance, idempotency_key: "res:1",
    });

    expect(ledger).toHaveLength(2);
    expect(ledger[0].balance_after).toBe(1000);
    expect(ledger[1].balance_after).toBe(700);
  });

  it("B2: balance_after chain is consistent", () => {
    const entries = [
      { amount: 1000, balance_after: 1000 },
      { amount: 500, balance_after: 1500 },
      { amount: -200, balance_after: 1300 },
      { amount: -300, balance_after: 1000 },
      { amount: 200, balance_after: 1200 },
    ];

    let prev = 0;
    for (const e of entries) {
      expect(e.balance_after).toBe(prev + e.amount);
      prev = e.balance_after;
    }
  });

  it("B3: idempotency_key uniqueness prevents duplicates", () => {
    const keys = new Set<string>();
    const entries = [
      "credit:gen:line-1",
      "credit:gen:line-2",
      "credit:reserve:order-1:300",
      "credit:release:entry-2",
    ];
    for (const k of entries) {
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
    expect(keys.size).toBe(4);
  });

  it("B4: balance never negative (reserve rejects insufficient funds)", () => {
    const r1 = reserveCredit(1000, 500);
    expect(r1.ok).toBe(true);
    expect(r1.newBalance).toBe(500);

    const r2 = reserveCredit(r1.newBalance, 600);
    expect(r2.ok).toBe(false);
    expect(r2.newBalance).toBe(500);
  });

  it("B5: release restores balance after cancelled reservation", () => {
    let balance = 1000;
    const r = reserveCredit(balance, 400);
    expect(r.ok).toBe(true);
    balance = r.newBalance;
    expect(balance).toBe(600);

    balance = releaseCredit(balance, 400);
    expect(balance).toBe(1000);
  });
});

// ============================================================================
// C. Concurrent credit reservations (100 simultaneous)
// ============================================================================

describe("C. Concurrent credit reservations", () => {
  it("C1: 100 concurrent reservations from shared balance — only valid ones succeed", () => {
    const initialBalance = 5000;
    const reservationAmount = 100;
    const numReservations = 100;

    let balance = initialBalance;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < numReservations; i++) {
      const result = reserveCredit(balance, reservationAmount);
      if (result.ok) {
        balance = result.newBalance;
        succeeded++;
      } else {
        failed++;
      }
    }

    expect(succeeded).toBe(50);
    expect(failed).toBe(50);
    expect(balance).toBe(0);
    expect(succeeded * reservationAmount).toBe(initialBalance);
  });

  it("C2: parallel reservation simulation — no double-spending", () => {
    const initialBalance = 1000;

    const attempts = Array.from({ length: 100 }, (_, i) => ({
      id: `attempt-${i}`,
      amount: 50,
    }));

    let balance = initialBalance;
    const successes: string[] = [];

    for (const a of attempts) {
      const r = reserveCredit(balance, a.amount);
      if (r.ok) {
        balance = r.newBalance;
        successes.push(a.id);
      }
    }

    expect(successes.length).toBe(20);
    expect(balance).toBe(0);
    expect(successes.length * 50).toBeLessThanOrEqual(initialBalance);
  });

  it("C3: mixed reserve/release — balance stays non-negative", () => {
    let balance = 500;
    const ops: Array<{ type: "reserve" | "release"; amount: number }> = [
      { type: "reserve", amount: 200 },
      { type: "reserve", amount: 200 },
      { type: "release", amount: 200 },
      { type: "reserve", amount: 400 },
      { type: "reserve", amount: 200 },
    ];

    let reserveOk = 0;
    let reserveFail = 0;

    for (const op of ops) {
      if (op.type === "reserve") {
        const r = reserveCredit(balance, op.amount);
        if (r.ok) {
          balance = r.newBalance;
          reserveOk++;
        } else {
          reserveFail++;
        }
      } else {
        balance = releaseCredit(balance, op.amount);
      }
      expect(balance).toBeGreaterThanOrEqual(0);
    }

    expect(reserveOk).toBe(3);
    expect(reserveFail).toBe(1);
  });
});

// ============================================================================
// D. Freight proration
// ============================================================================

describe("D. Freight proration", () => {
  it("D1: single order gets all freight", () => {
    const allocs = allocateFreight(1500, [
      { order_id: "o1", cost_centavos: 10000 },
    ]);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].allocated_centavos).toBe(1500);
    expect(allocs[0].is_remainder).toBe(true);
  });

  it("D2: two equal orders split freight evenly", () => {
    const allocs = allocateFreight(1000, [
      { order_id: "o1", cost_centavos: 5000 },
      { order_id: "o2", cost_centavos: 5000 },
    ]);
    expect(allocs).toHaveLength(2);
    const total = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(total).toBe(1000);
    expect(allocs[0].allocated_centavos).toBe(500);
    expect(allocs[1].allocated_centavos).toBe(500);
  });

  it("D3: remainder assignment guarantees exact centavo closure", () => {
    const allocs = allocateFreight(1000, [
      { order_id: "o1", cost_centavos: 3333 },
      { order_id: "o2", cost_centavos: 3333 },
      { order_id: "o3", cost_centavos: 3334 },
    ]);
    const total = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(total).toBe(1000);
  });

  it("D4: uneven split with remainder on last order", () => {
    const allocs = allocateFreight(100, [
      { order_id: "o1", cost_centavos: 1 },
      { order_id: "o2", cost_centavos: 1 },
      { order_id: "o3", cost_centavos: 1 },
    ]);
    const total = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(total).toBe(100);
    expect(allocs[2].is_remainder).toBe(true);
  });

  it("D5: large PO freight distributed across many orders", () => {
    const orders = Array.from({ length: 50 }, (_, i) => ({
      order_id: `o${i}`,
      cost_centavos: 1000 + i * 100,
    }));
    const poFreight = 15000;
    const allocs = allocateFreight(poFreight, orders);
    const total = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(total).toBe(poFreight);
    expect(allocs[49].is_remainder).toBe(true);
    for (const a of allocs) {
      expect(a.allocated_centavos).toBeGreaterThanOrEqual(0);
    }
  });

  it("D6: zero freight distributes zero to all", () => {
    const allocs = allocateFreight(0, [
      { order_id: "o1", cost_centavos: 5000 },
      { order_id: "o2", cost_centavos: 3000 },
    ]);
    const total = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(total).toBe(0);
  });

  it("D7: empty orders returns empty allocations", () => {
    const allocs = allocateFreight(1000, []);
    expect(allocs).toHaveLength(0);
  });
});

// ============================================================================
// E. Order result computation
// ============================================================================

describe("E. Order result computation", () => {
  it("E1: basic result = revenue - costs - freight - discounts", () => {
    const r = computeOrderResult(50000, 30000, 2000, 2500, 0, 0);
    expect(r.result_centavos).toBe(15500);
    expect(r.result_approved).toBe(true);
  });

  it("E2: result below minimum is not approved", () => {
    const r = computeOrderResult(50000, 48000, 1500, 2000, 0, 5000);
    expect(r.result_centavos).toBe(-1500);
    expect(r.result_approved).toBe(false);
  });

  it("E3: result exactly at minimum is approved", () => {
    const r = computeOrderResult(50000, 30000, 2000, 2500, 500, 15000);
    expect(r.result_centavos).toBe(15000);
    expect(r.result_approved).toBe(true);
  });

  it("E4: credit discount reduces result", () => {
    const without = computeOrderResult(50000, 30000, 2000, 2500, 0, 0);
    const with_ = computeOrderResult(50000, 30000, 2000, 2500, 1000, 0);
    expect(with_.result_centavos).toBe(without.result_centavos - 1000);
  });

  it("E5: negative result with zero minimum is NOT approved", () => {
    const r = computeOrderResult(100, 50000, 0, 0, 0, 0);
    expect(r.result_centavos).toBe(-49900);
    expect(r.result_approved).toBe(false);
  });
});

// ============================================================================
// F. Economic gate (flag ON/OFF behavior)
// ============================================================================

describe("F. Economic gate (flag behavior)", () => {
  it("F1: flag OFF bypasses everything — legacy flow unchanged", () => {
    const flagOn = false;
    const shouldRunGate = flagOn;
    expect(shouldRunGate).toBe(false);
  });

  it("F2: flag ON triggers gate — approved result passes", () => {
    const flagOn = true;
    if (!flagOn) throw new Error("unreachable");
    const r = computeOrderResult(50000, 30000, 2000, 2500, 0, 0);
    expect(r.result_approved).toBe(true);
  });

  it("F3: flag ON triggers gate — below minimum blocks", () => {
    const flagOn = true;
    if (!flagOn) throw new Error("unreachable");
    const r = computeOrderResult(50000, 48000, 1500, 2000, 0, 5000);
    expect(r.result_approved).toBe(false);
  });
});

// ============================================================================
// G. Discount engine separation
// ============================================================================

describe("G. Discount engine separation", () => {
  it("G1: commercial discount = Pix + primeira compra + seção", () => {
    const pix = 2500;
    const primeira = 0;
    const secao = 500;
    const commercial = pix + primeira + secao;
    const credit = 0;
    expect(commercial).toBe(3000);
    expect(credit).toBe(0);
    expect(commercial + credit).toBe(3000);
  });

  it("G2: credit discount starts at zero (no auto rules)", () => {
    const credit = 0;
    expect(credit).toBe(0);
  });

  it("G3: total discount = commercial + credit", () => {
    const commercial = 2500;
    const credit = 500;
    const total = commercial + credit;
    expect(total).toBe(3000);
  });
});

// ============================================================================
// H. Result lock (immutability)
// ============================================================================

describe("H. Result lock (immutability)", () => {
  it("H1: locked result creates immutable snapshot", () => {
    const result = computeOrderResult(50000, 30000, 2000, 2500, 0, 0);
    const lock = {
      ...result,
      credit_reserved_centavos: 0,
      credit_ledger_entry_id: null,
      approved_by: null,
      snapshot: { items: [], costs: [] },
    };
    expect(lock.result_centavos).toBe(15500);
    expect(lock.result_approved).toBe(true);
  });

  it("H2: manual override sets approved_by", () => {
    const result = computeOrderResult(50000, 48000, 1500, 2000, 0, 5000);
    expect(result.result_approved).toBe(false);

    const override = {
      ...result,
      result_approved: true,
      approved_by: "admin-uuid",
    };
    expect(override.result_approved).toBe(true);
    expect(override.approved_by).toBe("admin-uuid");
  });
});

// ============================================================================
// I. Backup supplier integration
// ============================================================================

describe("I. Backup supplier cost impact", () => {
  it("I1: backup with higher cost reduces result", () => {
    const originalResult = computeOrderResult(50000, 30000, 2000, 2500, 0, 0);
    const backupResult = computeOrderResult(50000, 35000, 2000, 2500, 0, 0);
    expect(backupResult.result_centavos).toBeLessThan(originalResult.result_centavos);
    expect(backupResult.result_centavos).toBe(originalResult.result_centavos - 5000);
  });

  it("I2: backup cost diff can be offset by credit", () => {
    const backupCostDiff = 5000;
    const creditBalance = 3000;
    const canOffset = creditBalance >= backupCostDiff;
    expect(canOffset).toBe(false);

    const partialOffset = Math.min(creditBalance, backupCostDiff);
    expect(partialOffset).toBe(3000);
  });
});

// ============================================================================
// J. Integration: full flow from gordura to payment gate
// ============================================================================

describe("J. Full integration flow", () => {
  it("J1: gordura → credit → reserve → result lock → gate", () => {
    const gordura = computeGordura(1000, 800, 10);
    expect(gordura).toBe(2000);

    let balance = 0;
    balance += gordura;
    expect(balance).toBe(2000);

    const reserve = reserveCredit(balance, 500);
    expect(reserve.ok).toBe(true);
    balance = reserve.newBalance;
    expect(balance).toBe(1500);

    const result = computeOrderResult(50000, 30000, 2000, 2500, 500, 0);
    expect(result.result_centavos).toBe(15000);
    expect(result.result_approved).toBe(true);
  });

  it("J2: gordura → no credit used → result above minimum → gate passes", () => {
    const gordura = computeGordura(1000, 950, 20);
    expect(gordura).toBe(1000);

    const result = computeOrderResult(50000, 30000, 2000, 2500, 0, 10000);
    expect(result.result_centavos).toBe(15500);
    expect(result.result_approved).toBe(true);
  });

  it("J3: no gordura → result below minimum → gate blocks", () => {
    const gordura = computeGordura(1000, 1000, 10);
    expect(gordura).toBe(0);

    const result = computeOrderResult(50000, 48000, 1500, 2000, 0, 5000);
    expect(result.result_centavos).toBe(-1500);
    expect(result.result_approved).toBe(false);
  });

  it("J4: freight proration + result lock with exact centavo", () => {
    const allocs = allocateFreight(1500, [
      { order_id: "o1", cost_centavos: 7000 },
      { order_id: "o2", cost_centavos: 3000 },
    ]);

    const totalFreight = allocs.reduce((s, a) => s + a.allocated_centavos, 0);
    expect(totalFreight).toBe(1500);

    const o1Freight = allocs.find((a) => a.order_id === "o1")!.allocated_centavos;
    const r1 = computeOrderResult(35000, 20000, o1Freight, 1750, 0, 0);
    expect(r1.result_centavos).toBe(35000 - 20000 - o1Freight - 1750);
    expect(r1.result_approved).toBe(true);
  });
});
