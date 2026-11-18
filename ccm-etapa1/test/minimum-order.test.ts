import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateMinimumOrderOptions,
  type MinOrderContext,
  type SupplierTerms,
  type AlternativeSupplier,
  type EligibleExtraItem,
} from "../../src/lib/minimum-order.ts";

function baseCtx(overrides: Partial<MinOrderContext> = {}): MinOrderContext {
  return {
    poId: "po-001",
    supplierId: "SUP-001",
    cycleDateStr: "2026-11-17",
    totalCentavos: 50000,
    itemCount: 5,
    minimumType: "valor",
    minimumValue: 1000,
    freightType: "fixo",
    freightFreeAbove: 1000,
    freightValue: 50,
    ...overrides,
  };
}

function baseTerms(overrides: Partial<SupplierTerms> = {}): SupplierTerms {
  return {
    diasPedido: [1, 3, 5],
    prazoEntregaCdDias: 2,
    cutoffTime: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST J: calculateMinimumOrderOptions — 4 options
// ═══════════════════════════════════════════════════════════════════════════

test("J1: always returns exactly 4 options", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 3);
  assert.equal(options.length, 4);
  const types = options.map((o) => o.type);
  assert.ok(types.includes("wait_next_cycle"));
  assert.ok(types.includes("move_supplier"));
  assert.ok(types.includes("pay_fee"));
  assert.ok(types.includes("complete_extra"));
});

test("J2: wait_next_cycle computes next cycle date", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 2);
  const wait = options.find((o) => o.type === "wait_next_cycle")!;
  assert.ok(wait.available);
  assert.ok(wait.newDate);
  assert.equal(wait.extraCostCentavos, 0);
  assert.equal(wait.affectedOrderCount, 2);
  assert.ok(wait.details.nextCycleDate);
  assert.ok(typeof wait.details.delayDays === "number");
});

test("J3: wait_next_cycle unavailable with empty diasPedido", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms({ diasPedido: [] }), [], [], 1);
  const wait = options.find((o) => o.type === "wait_next_cycle")!;
  assert.equal(wait.available, false);
  assert.ok(wait.reason);
});

test("J4: move_supplier picks cheapest eligible", () => {
  const alternatives: AlternativeSupplier[] = [
    { supplierId: "SUP-X", supplierName: "Expensive", totalCentavos: 120000, itemCount: 5, minimumMet: true, prazoEntregaCdDias: 3, diasPedido: [1, 3, 5] },
    { supplierId: "SUP-Y", supplierName: "Cheap", totalCentavos: 60000, itemCount: 5, minimumMet: true, prazoEntregaCdDias: 2, diasPedido: [2, 4] },
    { supplierId: "SUP-Z", supplierName: "No min", totalCentavos: 40000, itemCount: 3, minimumMet: false, prazoEntregaCdDias: 1, diasPedido: [1] },
  ];
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), alternatives, [], 2);
  const move = options.find((o) => o.type === "move_supplier")!;
  assert.ok(move.available);
  assert.equal(move.details.targetSupplierId, "SUP-Y");
  assert.equal(move.details.targetSupplierName, "Cheap");
  assert.equal(move.details.eligibleCount, 2);
});

test("J5: move_supplier unavailable when no eligible suppliers", () => {
  const alternatives: AlternativeSupplier[] = [
    { supplierId: "SUP-Z", supplierName: "No min", totalCentavos: 40000, itemCount: 3, minimumMet: false, prazoEntregaCdDias: 1, diasPedido: [1] },
  ];
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), alternatives, [], 1);
  const move = options.find((o) => o.type === "move_supplier")!;
  assert.equal(move.available, false);
  assert.ok(move.reason);
});

test("J6: pay_fee shows freight cost", () => {
  const options = calculateMinimumOrderOptions(baseCtx({ freightValue: 80, freightType: "fixo" }), baseTerms(), [], [], 1);
  const fee = options.find((o) => o.type === "pay_fee")!;
  assert.ok(fee.available);
  assert.equal(fee.extraCostCentavos, 8000);
  assert.ok(fee.newDate);
});

test("J7: pay_fee unavailable without freight config", () => {
  const options = calculateMinimumOrderOptions(
    baseCtx({ freightValue: null, freightType: null }),
    baseTerms(), [], [], 1,
  );
  const fee = options.find((o) => o.type === "pay_fee")!;
  assert.equal(fee.available, false);
});

test("J8: complete_extra suggests items to fill gap (valor)", () => {
  const extras: EligibleExtraItem[] = [
    { masterProductId: "P1", productName: "Produto A", unitCostCentavos: 2000, packagingQty: 6, currentStock: 10, maxSobraPercent: 20 },
    { masterProductId: "P2", productName: "Produto B", unitCostCentavos: 5000, packagingQty: 4, currentStock: 5, maxSobraPercent: 10 },
  ];
  const ctx = baseCtx({ totalCentavos: 50000, minimumValue: 1000, minimumType: "valor" });
  const options = calculateMinimumOrderOptions(ctx, baseTerms(), [], extras, 2);
  const extra = options.find((o) => o.type === "complete_extra")!;
  assert.ok(extra.available);
  assert.ok(extra.extraCostCentavos > 0);
  assert.ok(extra.details.choiceIsManual === true);
  assert.ok(Array.isArray(extra.details.suggestedItems));
});

test("J9: complete_extra unavailable with no eligible items", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 1);
  const extra = options.find((o) => o.type === "complete_extra")!;
  assert.equal(extra.available, false);
  assert.ok(extra.reason);
});

test("J10: affectedOrderCount propagated to all options", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 7);
  for (const opt of options) {
    assert.equal(opt.affectedOrderCount, 7);
  }
});

test("J11: each option has label, extraCostCentavos, type", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 1);
  for (const opt of options) {
    assert.ok(typeof opt.type === "string");
    assert.ok(typeof opt.label === "string");
    assert.ok(typeof opt.extraCostCentavos === "number");
    assert.ok(typeof opt.available === "boolean");
    assert.ok(typeof opt.details === "object");
  }
});

test("J12: volume minimum computes gap in units", () => {
  const ctx = baseCtx({ minimumType: "volume", minimumValue: 20, itemCount: 12, totalCentavos: 50000 });
  const extras: EligibleExtraItem[] = [
    { masterProductId: "P1", productName: "Prod A", unitCostCentavos: 1000, packagingQty: 10, currentStock: 5, maxSobraPercent: 15 },
  ];
  const options = calculateMinimumOrderOptions(ctx, baseTerms(), [], extras, 1);
  const extra = options.find((o) => o.type === "complete_extra")!;
  assert.ok(extra.available);
  assert.equal(extra.details.gapUnit, "unidades");
  assert.equal(extra.details.gap, 8);
});

test("J13: no option triggers automatic spending", () => {
  const options = calculateMinimumOrderOptions(baseCtx(), baseTerms(), [], [], 1);
  for (const opt of options) {
    assert.ok(!("autoExecute" in opt));
    assert.ok(!("execute" in opt));
  }
});
