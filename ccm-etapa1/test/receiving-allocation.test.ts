import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateReceivingItem,
  summarizeReceiving,
  type ReceivingItemInput,
} from "../../src/lib/receiving.ts";
import {
  allocateStock,
  analyzeShortageImpact,
  type ReceivedProduct,
  type PendingShipmentItem,
} from "../../src/lib/allocation.ts";

// ═══════════════════════════════════════════════════════════════════════════
// TEST D: validateReceivingItem
// ═══════════════════════════════════════════════════════════════════════════

test("D1: valid item — exact match", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 10,
    acceptedQty: 10,
    damagedQty: 0,
  });
  assert.equal(r.valid, true);
  assert.equal(r.shortage, 0);
  assert.equal(r.excess, 0);
  assert.equal(r.errors.length, 0);
});

test("D2: shortage computed correctly", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 7,
    acceptedQty: 6,
    damagedQty: 1,
  });
  assert.equal(r.valid, true);
  assert.equal(r.shortage, 3);
  assert.equal(r.excess, 0);
});

test("D3: excess computed correctly", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 13,
    acceptedQty: 12,
    damagedQty: 1,
  });
  assert.equal(r.valid, true);
  assert.equal(r.shortage, 0);
  assert.equal(r.excess, 3);
});

test("D4: accepted + damaged > received is invalid", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 5,
    acceptedQty: 4,
    damagedQty: 3,
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("accepted + damaged")));
});

test("D5: negative quantities are invalid", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: -1,
    acceptedQty: 0,
    damagedQty: 0,
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("negative")));
});

test("D6: summarizeReceiving computes totals and divergence", () => {
  const items: ReceivingItemInput[] = [
    { purchaseOrderItemId: "a", masterProductId: "m1", expectedQty: 10, receivedQty: 8, acceptedQty: 7, damagedQty: 1 },
    { purchaseOrderItemId: "b", masterProductId: "m2", expectedQty: 20, receivedQty: 20, acceptedQty: 20, damagedQty: 0 },
  ];
  const s = summarizeReceiving(items);
  assert.equal(s.totalExpected, 30);
  assert.equal(s.totalReceived, 28);
  assert.equal(s.totalAccepted, 27);
  assert.equal(s.totalDamaged, 1);
  assert.equal(s.itemCount, 2);
  assert.ok(Math.abs(s.divergenceRate - 2 / 30) < 0.0001);
});

test("D7: summarizeReceiving with empty list", () => {
  const s = summarizeReceiving([]);
  assert.equal(s.totalExpected, 0);
  assert.equal(s.divergenceRate, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST E: allocateStock
// ═══════════════════════════════════════════════════════════════════════════

let orderItemSeq = 0;
const makeShipmentItem = (
  shipmentId: string,
  orderId: string,
  productId: string,
  qty: number,
  promisedTo: string | null,
  createdAt: string | null,
): PendingShipmentItem => ({
  orderItemId: `oi-${++orderItemSeq}`,
  shipmentId,
  orderId,
  masterProductId: productId,
  quantity: qty,
  promisedTo,
  createdAt,
});

test("E1: oldest promised_to gets priority", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 5 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s-new", "o-new", "p1", 5, "2026-12-15", "2026-11-01T10:00:00Z"),
    makeShipmentItem("s-old", "o-old", "p1", 5, "2026-12-10", "2026-11-05T10:00:00Z"),
  ];
  const plan = allocateStock(received, pending);
  assert.ok(plan.fullyAllocatedShipments.includes("s-old"));
  assert.ok(!plan.fullyAllocatedShipments.includes("s-new"));
});

test("E2: maximize complete orders — skips partial to fulfill another fully", () => {
  const received: ReceivedProduct[] = [
    { masterProductId: "p1", acceptedQty: 5 },
    { masterProductId: "p2", acceptedQty: 3 },
  ];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s-big", "o-big", "p1", 5, "2026-12-10", null),
    makeShipmentItem("s-big", "o-big", "p2", 5, "2026-12-10", null),
    makeShipmentItem("s-small", "o-small", "p2", 3, "2026-12-12", null),
  ];
  const plan = allocateStock(received, pending);
  // s-big needs 5 of p2 but only 3 available → cannot complete
  // s-small needs only 3 of p2 → can complete (but it's later promisedTo)
  // Pass 1 skips s-big (can't complete), allocates s-small
  assert.ok(plan.fullyAllocatedShipments.includes("s-small"));
  assert.ok(plan.partiallyAllocatedShipments.includes("s-big"));
});

test("E3: earliest createdAt wins when promised_to is equal", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 5 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s-late-pay", "o1", "p1", 5, "2026-12-10", "2026-11-05T10:00:00Z"),
    makeShipmentItem("s-early-pay", "o2", "p1", 5, "2026-12-10", "2026-11-01T10:00:00Z"),
  ];
  const plan = allocateStock(received, pending);
  assert.ok(plan.fullyAllocatedShipments.includes("s-early-pay"));
  assert.ok(!plan.fullyAllocatedShipments.includes("s-late-pay"));
});

test("E4: returns pure plan — does not mutate inputs", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 10 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", null),
  ];
  const receivedBefore = JSON.stringify(received);
  const pendingBefore = JSON.stringify(pending);
  allocateStock(received, pending);
  assert.equal(JSON.stringify(received), receivedBefore);
  assert.equal(JSON.stringify(pending), pendingBefore);
});

test("E5: remaining stock tracked after allocation", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 15 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 10, "2026-12-10", null),
  ];
  const plan = allocateStock(received, pending);
  assert.equal(plan.remainingStock.get("p1"), 5);
});

test("E6: zero received → all unallocated", () => {
  const received: ReceivedProduct[] = [];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", null),
  ];
  const plan = allocateStock(received, pending);
  assert.equal(plan.fullyAllocatedShipments.length, 0);
  assert.equal(plan.partiallyAllocatedShipments.length, 0);
  assert.ok(plan.unallocatedShipments.includes("s1"));
});

test("E7: multi-product shipment — all-or-nothing in pass 1", () => {
  const received: ReceivedProduct[] = [
    { masterProductId: "p1", acceptedQty: 10 },
    { masterProductId: "p2", acceptedQty: 10 },
  ];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", null),
    makeShipmentItem("s1", "o1", "p2", 5, "2026-12-10", null),
  ];
  const plan = allocateStock(received, pending);
  assert.ok(plan.fullyAllocatedShipments.includes("s1"));
  assert.equal(plan.allocations.length, 2);
  assert.equal(plan.remainingStock.get("p1"), 5);
  assert.equal(plan.remainingStock.get("p2"), 5);
});

test("E8: null promisedTo sorts last", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 5 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s-null", "o1", "p1", 5, null, null),
    makeShipmentItem("s-dated", "o2", "p1", 5, "2026-12-15", null),
  ];
  const plan = allocateStock(received, pending);
  assert.ok(plan.fullyAllocatedShipments.includes("s-dated"));
  assert.ok(!plan.fullyAllocatedShipments.includes("s-null"));
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST F: analyzeShortageImpact
// ═══════════════════════════════════════════════════════════════════════════

test("F1: shortage maps to affected shipments and orders", () => {
  const shortages = [{ masterProductId: "p1", shortageQty: 3 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, null, null),
    makeShipmentItem("s2", "o2", "p1", 3, null, null),
    makeShipmentItem("s3", "o3", "p2", 10, null, null),
  ];
  const impact = analyzeShortageImpact(shortages, pending);
  assert.equal(impact.length, 1);
  assert.equal(impact[0].masterProductId, "p1");
  assert.equal(impact[0].shortageQty, 3);
  assert.deepEqual(impact[0].affectedShipmentIds.sort(), ["s1", "s2"]);
  assert.deepEqual(impact[0].affectedOrderIds.sort(), ["o1", "o2"]);
});

test("F2: zero shortage filtered out", () => {
  const shortages = [{ masterProductId: "p1", shortageQty: 0 }];
  const impact = analyzeShortageImpact(shortages, []);
  assert.equal(impact.length, 0);
});

test("F3: multiple shortages", () => {
  const shortages = [
    { masterProductId: "p1", shortageQty: 2 },
    { masterProductId: "p2", shortageQty: 5 },
  ];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 10, null, null),
    makeShipmentItem("s1", "o1", "p2", 10, null, null),
  ];
  const impact = analyzeShortageImpact(shortages, pending);
  assert.equal(impact.length, 2);
  assert.equal(impact[0].affectedShipmentIds[0], "s1");
  assert.equal(impact[1].affectedShipmentIds[0], "s1");
});

test("F4: dedup affected orders when same order has multiple shipments", () => {
  const shortages = [{ masterProductId: "p1", shortageQty: 5 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, null, null),
    makeShipmentItem("s2", "o1", "p1", 3, null, null),
  ];
  const impact = analyzeShortageImpact(shortages, pending);
  assert.equal(impact[0].affectedOrderIds.length, 1);
  assert.equal(impact[0].affectedOrderIds[0], "o1");
  assert.equal(impact[0].affectedShipmentIds.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST G: Determinismo, idempotência lógica, edge cases adicionais
// ═══════════════════════════════════════════════════════════════════════════

test("G1: allocateStock is deterministic — same input → same output", () => {
  const received: ReceivedProduct[] = [
    { masterProductId: "p1", acceptedQty: 10 },
    { masterProductId: "p2", acceptedQty: 5 },
  ];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", "2026-11-01T10:00:00Z"),
    makeShipmentItem("s2", "o2", "p1", 5, "2026-12-12", "2026-11-02T10:00:00Z"),
    makeShipmentItem("s3", "o3", "p2", 3, "2026-12-11", null),
    makeShipmentItem("s4", "o4", "p2", 4, "2026-12-13", null),
  ];
  const plan1 = allocateStock(received, pending);
  const plan2 = allocateStock(received, pending);
  const plan3 = allocateStock(received, pending);
  assert.deepEqual(plan1.fullyAllocatedShipments.sort(), plan2.fullyAllocatedShipments.sort());
  assert.deepEqual(plan2.fullyAllocatedShipments.sort(), plan3.fullyAllocatedShipments.sort());
  assert.deepEqual(
    plan1.allocations.map((a) => `${a.shipmentId}:${a.masterProductId}:${a.allocatedQty}`).sort(),
    plan2.allocations.map((a) => `${a.shipmentId}:${a.masterProductId}:${a.allocatedQty}`).sort(),
  );
});

test("G2: allocation plan quantities never exceed received stock", () => {
  const received: ReceivedProduct[] = [
    { masterProductId: "p1", acceptedQty: 7 },
  ];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", null),
    makeShipmentItem("s2", "o2", "p1", 5, "2026-12-11", null),
    makeShipmentItem("s3", "o3", "p1", 5, "2026-12-12", null),
  ];
  const plan = allocateStock(received, pending);
  const totalAllocated = plan.allocations
    .filter((a) => a.masterProductId === "p1")
    .reduce((s, a) => s + a.allocatedQty, 0);
  assert.ok(totalAllocated <= 7, `Allocated ${totalAllocated} but only 7 received`);
  assert.equal(totalAllocated + (plan.remainingStock.get("p1") || 0), 7);
});

test("G3: validateReceivingItem — all zeroes is valid (item not delivered)", () => {
  const r = validateReceivingItem({
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 0,
    acceptedQty: 0,
    damagedQty: 0,
  });
  assert.equal(r.valid, true);
  assert.equal(r.shortage, 10);
  assert.equal(r.excess, 0);
});

test("G4: allocation with many shipments same product — respects priority chain", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 15 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s-prom-old-pay-new", "o1", "p1", 5, "2026-12-05", "2026-11-10T00:00:00Z"),
    makeShipmentItem("s-prom-old-pay-old", "o2", "p1", 5, "2026-12-05", "2026-11-01T00:00:00Z"),
    makeShipmentItem("s-prom-new", "o3", "p1", 5, "2026-12-15", "2026-11-01T00:00:00Z"),
    makeShipmentItem("s-no-prom", "o4", "p1", 5, null, "2026-11-01T00:00:00Z"),
  ];
  const plan = allocateStock(received, pending);
  // Priority: promisedTo oldest first → among ties, createdAt oldest
  // s-prom-old-pay-old: 2026-12-05 / 2026-11-01 → 1st
  // s-prom-old-pay-new: 2026-12-05 / 2026-11-10 → 2nd
  // s-prom-new: 2026-12-15 → 3rd
  // s-no-prom: null → last
  // Only 15 available for 20 needed → 3 get fully, 1 doesn't
  assert.equal(plan.fullyAllocatedShipments.length, 3);
  assert.ok(plan.fullyAllocatedShipments.includes("s-prom-old-pay-old"));
  assert.ok(plan.fullyAllocatedShipments.includes("s-prom-old-pay-new"));
  assert.ok(plan.fullyAllocatedShipments.includes("s-prom-new"));
  assert.ok(!plan.fullyAllocatedShipments.includes("s-no-prom"));
});

test("G5: summarizeReceiving divergenceRate 100% when nothing received", () => {
  const items: ReceivingItemInput[] = [
    { purchaseOrderItemId: "a", masterProductId: "m1", expectedQty: 10, receivedQty: 0, acceptedQty: 0, damagedQty: 0 },
  ];
  const s = summarizeReceiving(items);
  assert.equal(s.divergenceRate, 1);
});

test("G6: analyzeShortageImpact — no pending shipments → empty impact", () => {
  const shortages = [{ masterProductId: "p1", shortageQty: 5 }];
  const impact = analyzeShortageImpact(shortages, []);
  assert.equal(impact.length, 1);
  assert.equal(impact[0].affectedShipmentIds.length, 0);
  assert.equal(impact[0].affectedOrderIds.length, 0);
});

test("G7: allocation pass 2 — partial allocation gives remaining to highest-priority", () => {
  const received: ReceivedProduct[] = [{ masterProductId: "p1", acceptedQty: 3 }];
  const pending: PendingShipmentItem[] = [
    makeShipmentItem("s1", "o1", "p1", 5, "2026-12-10", null),
    makeShipmentItem("s2", "o2", "p1", 5, "2026-12-15", null),
  ];
  const plan = allocateStock(received, pending);
  // Neither can be fully allocated (need 5, have 3)
  assert.equal(plan.fullyAllocatedShipments.length, 0);
  // Pass 2 should partially allocate s1 (oldest promisedTo)
  assert.ok(plan.partiallyAllocatedShipments.includes("s1"));
  const s1Alloc = plan.allocations.find((a) => a.shipmentId === "s1");
  assert.equal(s1Alloc?.allocatedQty, 3);
  assert.equal(plan.remainingStock.get("p1") || 0, 0);
});
