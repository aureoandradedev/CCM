// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import {
  computeCreditBalance,
  proratePOFreight,
  validateFreightClosure,
  projectResult,
  isResultAboveMinimum,
  calculateSavings,
  CREDIT_TYPES,
  type CreditMovement,
  type FreightAllocationInput,
} from "../economic-protection";

// ─── A. Credit balance ──────────────────────────────────────────────────

describe("computeCreditBalance", () => {
  it("A1: empty movements = 0", () => {
    expect(computeCreditBalance([])).toBe(0);
  });

  it("A2: single generation", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 500 },
    ];
    expect(computeCreditBalance(m)).toBe(500);
  });

  it("A3: generate then reserve", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 300 },
    ];
    expect(computeCreditBalance(m)).toBe(700);
  });

  it("A4: generate, reserve, release", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 300 },
      { movement_type: "credit_released", amount_centavos: 300 },
    ];
    expect(computeCreditBalance(m)).toBe(1000);
  });

  it("A5: credit_used has zero effect (audit-only)", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 300 },
      { movement_type: "credit_used", amount_centavos: 300 },
    ];
    expect(computeCreditBalance(m)).toBe(700);
  });

  it("A6: adjustment positive", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 500 },
      { movement_type: "credit_adjusted", amount_centavos: 200 },
    ];
    expect(computeCreditBalance(m)).toBe(700);
  });

  it("A7: adjustment negative", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 500 },
      { movement_type: "credit_adjusted", amount_centavos: -200 },
    ];
    expect(computeCreditBalance(m)).toBe(300);
  });

  it("A8: full lifecycle — generate, reserve, use, reverse, adjust", () => {
    const m: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 2000 },
      { movement_type: "credit_reserved", amount_centavos: 500 },
      { movement_type: "credit_used", amount_centavos: 300 },
      { movement_type: "credit_released", amount_centavos: 300 },
      { movement_type: "credit_reversed", amount_centavos: 100 },
    ];
    // 2000 - 500 + 0 + 300 + 100 = 1900 (credit_used=0 audit only)
    expect(computeCreditBalance(m)).toBe(1900);
  });
});

// ─── B. Freight proration ───────────────────────────────────────────────

describe("proratePOFreight", () => {
  it("B1: empty orders = no allocations", () => {
    expect(proratePOFreight([], 1000)).toEqual([]);
  });

  it("B2: zero freight = no allocations", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 5000 },
    ];
    expect(proratePOFreight(orders, 0)).toEqual([]);
  });

  it("B3: single order gets all freight", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 5000 },
    ];
    const result = proratePOFreight(orders, 1500);
    expect(result).toHaveLength(1);
    expect(result[0].freight_allocated_centavos).toBe(1500);
    expect(validateFreightClosure(result, 1500)).toBe(true);
  });

  it("B4: two orders proportional — exact split", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 5000 },
      { order_id: "o2", order_cost_centavos: 5000 },
    ];
    const result = proratePOFreight(orders, 1000);
    expect(result).toHaveLength(2);
    const total = result.reduce((s, r) => s + r.freight_allocated_centavos, 0);
    expect(total).toBe(1000);
    expect(validateFreightClosure(result, 1000)).toBe(true);
  });

  it("B5: remainder goes to highest-cost order", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 7000 },
      { order_id: "o2", order_cost_centavos: 3000 },
    ];
    const result = proratePOFreight(orders, 999);
    expect(validateFreightClosure(result, 999)).toBe(true);
    const o1 = result.find((r) => r.order_id === "o1")!;
    const o2 = result.find((r) => r.order_id === "o2")!;
    expect(o1.freight_allocated_centavos + o2.freight_allocated_centavos).toBe(999);
    expect(o1.freight_allocated_centavos).toBeGreaterThan(o2.freight_allocated_centavos);
  });

  it("B6: three orders, odd freight — closure guaranteed", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 3333 },
      { order_id: "o2", order_cost_centavos: 3333 },
      { order_id: "o3", order_cost_centavos: 3334 },
    ];
    const result = proratePOFreight(orders, 100);
    expect(validateFreightClosure(result, 100)).toBe(true);
  });

  it("B7: 1 centavo freight across 3 orders", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 100 },
      { order_id: "o2", order_cost_centavos: 200 },
      { order_id: "o3", order_cost_centavos: 300 },
    ];
    const result = proratePOFreight(orders, 1);
    expect(validateFreightClosure(result, 1)).toBe(true);
    const total = result.reduce((s, r) => s + r.freight_allocated_centavos, 0);
    expect(total).toBe(1);
  });

  it("B8: large values — no overflow", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 50_000_00 },
      { order_id: "o2", order_cost_centavos: 30_000_00 },
      { order_id: "o3", order_cost_centavos: 20_000_00 },
    ];
    const result = proratePOFreight(orders, 15_000_00);
    expect(validateFreightClosure(result, 15_000_00)).toBe(true);
  });

  it("B9: all orders same cost — still closes", () => {
    const orders: FreightAllocationInput[] = Array.from({ length: 7 }, (_, i) => ({
      order_id: `o${i}`,
      order_cost_centavos: 1000,
    }));
    const result = proratePOFreight(orders, 100);
    expect(validateFreightClosure(result, 100)).toBe(true);
  });
});

// ─── C. Result projection ───────────────────────────────────────────────

describe("projectResult", () => {
  it("C1: basic projection", () => {
    const r = projectResult({
      revenueCentavos: 10000,
      discountCentavos: 500,
      creditDiscountCentavos: 200,
      supplierCostCentavos: 6000,
      supplierFreightCentavos: 1000,
    });
    expect(r.projected_result_centavos).toBe(10000 - 6000 - 1000 - 200);
    expect(r.projected_result_centavos).toBe(2800);
  });

  it("C2: negative result when costs exceed revenue", () => {
    const r = projectResult({
      revenueCentavos: 5000,
      discountCentavos: 0,
      creditDiscountCentavos: 0,
      supplierCostCentavos: 4000,
      supplierFreightCentavos: 2000,
    });
    expect(r.projected_result_centavos).toBe(-1000);
  });

  it("C3: zero everything", () => {
    const r = projectResult({
      revenueCentavos: 0,
      discountCentavos: 0,
      creditDiscountCentavos: 0,
      supplierCostCentavos: 0,
      supplierFreightCentavos: 0,
    });
    expect(r.projected_result_centavos).toBe(0);
  });
});

describe("isResultAboveMinimum", () => {
  it("C4: above minimum", () => {
    expect(isResultAboveMinimum(500, 100)).toBe(true);
  });

  it("C5: at minimum", () => {
    expect(isResultAboveMinimum(100, 100)).toBe(true);
  });

  it("C6: below minimum", () => {
    expect(isResultAboveMinimum(50, 100)).toBe(false);
  });

  it("C7: negative result, zero minimum", () => {
    expect(isResultAboveMinimum(-100, 0)).toBe(false);
  });
});

// ─── D. Savings calculation ─────────────────────────────────────────────

describe("calculateSavings", () => {
  it("D1: supplier cheaper = savings", () => {
    expect(calculateSavings(500, 400, 10)).toBe(1000);
  });

  it("D2: same price = zero", () => {
    expect(calculateSavings(400, 400, 10)).toBe(0);
  });

  it("D3: supplier more expensive = zero", () => {
    expect(calculateSavings(400, 500, 10)).toBe(0);
  });

  it("D4: single unit", () => {
    expect(calculateSavings(1000, 800, 1)).toBe(200);
  });
});

// ─── E. Credit lifecycle simulation ─────────────────────────────────────

describe("credit lifecycle", () => {
  it("E1: generate → reserve → use (audit-only)", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 1000 },
      { movement_type: "credit_used", amount_centavos: 1000 },
    ];
    expect(computeCreditBalance(movements)).toBe(0);
  });

  it("E2: generate → reserve → release (funds returned)", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 1000 },
      { movement_type: "credit_released", amount_centavos: 1000 },
    ];
    expect(computeCreditBalance(movements)).toBe(1000);
  });

  it("E3: reverse a used credit", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
      { movement_type: "credit_reserved", amount_centavos: 1000 },
      { movement_type: "credit_used", amount_centavos: 1000 },
      { movement_type: "credit_reversed", amount_centavos: 1000 },
    ];
    expect(computeCreditBalance(movements)).toBe(1000);
  });
});

// ─── F. Concurrency simulation: 100 simultaneous reservations ───────────

describe("concurrency: 100 simultaneous reservations", () => {
  it("F1: 100 × 10 from 1000 → exactly 0", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
    ];
    for (let i = 0; i < 100; i++) {
      movements.push({ movement_type: "credit_reserved", amount_centavos: 10 });
    }
    expect(computeCreditBalance(movements)).toBe(0);
  });

  it("F2: 101 × 10 from 1000 → -10 (rejected by SQL CHECK)", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 1000 },
    ];
    for (let i = 0; i < 101; i++) {
      movements.push({ movement_type: "credit_reserved", amount_centavos: 10 });
    }
    expect(computeCreditBalance(movements)).toBe(-10);
  });

  it("F3: mixed concurrent ops", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 5000 },
    ];
    for (let i = 0; i < 50; i++) movements.push({ movement_type: "credit_reserved", amount_centavos: 50 });
    for (let i = 0; i < 10; i++) movements.push({ movement_type: "credit_released", amount_centavos: 50 });
    for (let i = 0; i < 20; i++) movements.push({ movement_type: "credit_used", amount_centavos: 50 });
    expect(computeCreditBalance(movements)).toBe(3000);
  });

  it("F4: 333 × 1 from 333 → no centavo lost", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 333 },
    ];
    for (let i = 0; i < 333; i++) movements.push({ movement_type: "credit_reserved", amount_centavos: 1 });
    expect(computeCreditBalance(movements)).toBe(0);
  });
});

// ─── G. Result lock + economic gate simulation ──────────────────────────

describe("result lock decision simulation", () => {
  it("G1: result above minimum → auto_approved", () => {
    const r = projectResult({
      revenueCentavos: 10000, discountCentavos: 1000,
      creditDiscountCentavos: 200, supplierCostCentavos: 6000, supplierFreightCentavos: 500,
    });
    expect(r.projected_result_centavos).toBe(3300);
    expect(isResultAboveMinimum(r.projected_result_centavos, 0)).toBe(true);
  });

  it("G2: result below minimum → pending", () => {
    const r = projectResult({
      revenueCentavos: 10000, discountCentavos: 1000,
      creditDiscountCentavos: 200, supplierCostCentavos: 9000, supplierFreightCentavos: 500,
    });
    expect(r.projected_result_centavos).toBe(300);
    expect(isResultAboveMinimum(r.projected_result_centavos, 500)).toBe(false);
  });

  it("G3: zero revenue → negative", () => {
    const r = projectResult({
      revenueCentavos: 0, discountCentavos: 0,
      creditDiscountCentavos: 0, supplierCostCentavos: 1000, supplierFreightCentavos: 100,
    });
    expect(r.projected_result_centavos).toBe(-1100);
  });
});

// ─── H. Freight edge cases ──────────────────────────────────────────────

describe("freight proration edge cases", () => {
  it("H1: 100 orders, 1 centavo → one gets 1", () => {
    const orders: FreightAllocationInput[] = Array.from({ length: 100 }, (_, i) => ({
      order_id: `o${i}`, order_cost_centavos: 100,
    }));
    const result = proratePOFreight(orders, 1);
    const withFreight = result.filter(r => r.freight_allocated_centavos > 0);
    expect(withFreight).toHaveLength(1);
    expect(validateFreightClosure(result, 1)).toBe(true);
  });

  it("H2: very large numbers (BigInt safety)", () => {
    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 999_999_999 },
      { order_id: "o2", order_cost_centavos: 888_888_888 },
    ];
    const result = proratePOFreight(orders, 50_000_000);
    expect(result.every(r => Number.isFinite(r.freight_allocated_centavos))).toBe(true);
    expect(validateFreightClosure(result, 50_000_000)).toBe(true);
  });
});

// ─── I. Full flow simulation ────────────────────────────────────────────

describe("full economic protection flow", () => {
  it("I1: happy path — savings → credit → reserve → freight → lock → pay → use", () => {
    const saving = calculateSavings(500, 400, 10);
    expect(saving).toBe(1000);

    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: saving },
    ];
    expect(computeCreditBalance(movements)).toBe(1000);

    movements.push({ movement_type: "credit_reserved", amount_centavos: 500 });
    expect(computeCreditBalance(movements)).toBe(500);

    const orders: FreightAllocationInput[] = [
      { order_id: "o1", order_cost_centavos: 4000 },
      { order_id: "o2", order_cost_centavos: 6000 },
    ];
    const freight = proratePOFreight(orders, 1000);
    expect(validateFreightClosure(freight, 1000)).toBe(true);

    const o1Freight = freight.find(f => f.order_id === "o1")!.freight_allocated_centavos;
    const r = projectResult({
      revenueCentavos: 10000, discountCentavos: 200, creditDiscountCentavos: 500,
      supplierCostCentavos: 4000, supplierFreightCentavos: o1Freight,
    });
    expect(r.projected_result_centavos).toBeGreaterThan(0);
    expect(isResultAboveMinimum(r.projected_result_centavos, 0)).toBe(true);

    movements.push({ movement_type: "credit_used", amount_centavos: 500 });
    expect(computeCreditBalance(movements)).toBe(500);
  });

  it("I2: cancellation path", () => {
    const movements: CreditMovement[] = [
      { movement_type: "credit_generated", amount_centavos: 500 },
      { movement_type: "credit_reserved", amount_centavos: 500 },
    ];
    expect(computeCreditBalance(movements)).toBe(0);
    movements.push({ movement_type: "credit_released", amount_centavos: 500 });
    expect(computeCreditBalance(movements)).toBe(500);
  });

  it("I3: rejected result — negative margin", () => {
    const r = projectResult({
      revenueCentavos: 5000, discountCentavos: 200, creditDiscountCentavos: 0,
      supplierCostCentavos: 6000, supplierFreightCentavos: 500,
    });
    expect(r.projected_result_centavos).toBe(-1500);
    expect(isResultAboveMinimum(r.projected_result_centavos, 0)).toBe(false);
  });
});

// ─── J. Security: credit_types effect values ────────────────────────────

describe("credit type security", () => {
  it("J1: credit_used = 0 (audit-only)", () => {
    expect(CREDIT_TYPES.credit_used).toBe(0);
  });

  it("J2: credit_reserved = -1", () => {
    expect(CREDIT_TYPES.credit_reserved).toBe(-1);
  });

  it("J3: credit_generated = +1", () => {
    expect(CREDIT_TYPES.credit_generated).toBe(1);
  });

  it("J4: credit_released = +1", () => {
    expect(CREDIT_TYPES.credit_released).toBe(1);
  });

  it("J5: credit_reversed = +1", () => {
    expect(CREDIT_TYPES.credit_reversed).toBe(1);
  });

  it("J6: all 6 movement types defined", () => {
    const types: Array<keyof typeof CREDIT_TYPES> = [
      "credit_generated", "credit_reserved", "credit_used",
      "credit_released", "credit_adjusted", "credit_reversed",
    ];
    for (const t of types) {
      expect(typeof CREDIT_TYPES[t]).toBe("number");
    }
    expect(Object.keys(CREDIT_TYPES)).toHaveLength(6);
  });
});
