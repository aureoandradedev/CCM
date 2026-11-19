/**
 * Tests A–I: allocation flow (0053 fix validation).
 *
 * npx vitest run src/lib/__tests__/allocation-flow.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import {
  allocateStock,
  analyzeShortageImpact,
  type ReceivedProduct,
  type PendingShipmentItem,
} from "../allocation";

function makeReceived(items: { id: string; qty: number }[]): ReceivedProduct[] {
  return items.map((i) => ({ masterProductId: i.id, acceptedQty: i.qty }));
}

function makePending(
  items: {
    orderItemId: string;
    shipmentId: string;
    orderId: string;
    masterProductId: string;
    quantity: number;
    promisedTo?: string | null;
    createdAt?: string | null;
  }[],
): PendingShipmentItem[] {
  return items.map((i) => ({
    orderItemId: i.orderItemId,
    shipmentId: i.shipmentId,
    orderId: i.orderId,
    masterProductId: i.masterProductId,
    quantity: i.quantity,
    promisedTo: i.promisedTo ?? null,
    createdAt: i.createdAt ?? null,
  }));
}

// ============================================================================
// A — Full allocation (all stock consumed, no surplus)
// ============================================================================
describe("A: Full allocation — exact match", () => {
  it("allocates all stock when supply equals demand", () => {
    const received = makeReceived([
      { id: "prod-A", qty: 5 },
      { id: "prod-B", qty: 3 },
    ]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 5 },
      { orderItemId: "oi-2", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-B", quantity: 3 },
    ]);

    const plan = allocateStock(received, pending);

    expect(plan.allocations).toHaveLength(2);
    expect(plan.fullyAllocatedShipments).toContain("sh-1");
    expect(plan.partiallyAllocatedShipments).toHaveLength(0);
    expect(plan.unallocatedShipments).toHaveLength(0);

    const totalA = plan.allocations
      .filter((a) => a.masterProductId === "prod-A")
      .reduce((s, a) => s + a.allocatedQty, 0);
    expect(totalA).toBe(5);

    expect(plan.remainingStock.get("prod-A")).toBe(0);
    expect(plan.remainingStock.get("prod-B")).toBe(0);
  });

  it("includes orderItemId in every allocation entry", () => {
    const received = makeReceived([{ id: "prod-A", qty: 2 }]);
    const pending = makePending([
      { orderItemId: "oi-99", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 2 },
    ]);

    const plan = allocateStock(received, pending);
    expect(plan.allocations[0].orderItemId).toBe("oi-99");
  });
});

// ============================================================================
// B — Surplus (more stock than demand)
// ============================================================================
describe("B: Surplus — stock exceeds demand", () => {
  it("allocates demand fully and reports remaining stock", () => {
    const received = makeReceived([{ id: "prod-A", qty: 10 }]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 3 },
    ]);

    const plan = allocateStock(received, pending);

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].allocatedQty).toBe(3);
    expect(plan.fullyAllocatedShipments).toContain("sh-1");
    expect(plan.remainingStock.get("prod-A")).toBe(7);
  });

  it("allocates nothing when no pending orders exist", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const plan = allocateStock(received, []);

    expect(plan.allocations).toHaveLength(0);
    expect(plan.remainingStock.get("prod-A")).toBe(5);
  });
});

// ============================================================================
// C — Shortage (less stock than demand)
// ============================================================================
describe("C: Shortage — demand exceeds stock", () => {
  it("partially allocates when stock is insufficient for full shipment", () => {
    const received = makeReceived([{ id: "prod-A", qty: 2 }]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 5 },
    ]);

    const plan = allocateStock(received, pending);

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].allocatedQty).toBe(2);
    expect(plan.partiallyAllocatedShipments).toContain("sh-1");
    expect(plan.fullyAllocatedShipments).toHaveLength(0);
    expect(plan.remainingStock.get("prod-A")).toBe(0);
  });

  it("analyzeShortageImpact returns affected orders", () => {
    const shortages = [{ masterProductId: "prod-A", shortageQty: 3 }];
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 5 },
      { orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2", masterProductId: "prod-A", quantity: 2 },
      { orderItemId: "oi-3", shipmentId: "sh-3", orderId: "ord-3", masterProductId: "prod-B", quantity: 4 },
    ]);

    const impact = analyzeShortageImpact(shortages, pending);

    expect(impact).toHaveLength(1);
    expect(impact[0].masterProductId).toBe("prod-A");
    expect(impact[0].shortageQty).toBe(3);
    expect(impact[0].affectedShipmentIds).toEqual(expect.arrayContaining(["sh-1", "sh-2"]));
    expect(impact[0].affectedOrderIds).toEqual(expect.arrayContaining(["ord-1", "ord-2"]));
  });
});

// ============================================================================
// D — Partial across 2 sessions (remaining need calculation)
// ============================================================================
describe("D: Partial allocation across sessions", () => {
  it("allocateStock computes plan independently (remaining need is RPC concern)", () => {
    // Session 1 allocated 3 of 5 → Session 2 receives 2 more
    // The frontend computes a fresh plan from current stock;
    // the RPC validates remaining_need via inventory_movements.
    const received = makeReceived([{ id: "prod-A", qty: 2 }]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 5 },
    ]);

    const plan = allocateStock(received, pending);

    // Client-side allocates min(available, demand)
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0].allocatedQty).toBe(2);
    expect(plan.partiallyAllocatedShipments).toContain("sh-1");
  });
});

// ============================================================================
// E — Two orders competing for same product (priority by promisedTo, then createdAt)
// ============================================================================
describe("E: Two orders competing — priority resolution", () => {
  it("favors earlier promisedTo", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending = makePending([
      {
        orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1",
        masterProductId: "prod-A", quantity: 3,
        promisedTo: "2026-12-05", createdAt: "2026-11-15T10:00:00Z",
      },
      {
        orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2",
        masterProductId: "prod-A", quantity: 4,
        promisedTo: "2026-12-01", createdAt: "2026-11-16T10:00:00Z",
      },
    ]);

    const plan = allocateStock(received, pending);

    // sh-2 has earlier promisedTo (Dec 1 vs Dec 5) → fully allocated first
    const sh2Alloc = plan.allocations.find((a) => a.shipmentId === "sh-2");
    expect(sh2Alloc).toBeDefined();
    expect(sh2Alloc!.allocatedQty).toBe(4);
    expect(plan.fullyAllocatedShipments).toContain("sh-2");

    // sh-1 gets remaining 1 (partial)
    const sh1Alloc = plan.allocations.find((a) => a.shipmentId === "sh-1");
    expect(sh1Alloc).toBeDefined();
    expect(sh1Alloc!.allocatedQty).toBe(1);
    expect(plan.partiallyAllocatedShipments).toContain("sh-1");
  });

  it("favors earlier createdAt when promisedTo is equal", () => {
    const received = makeReceived([{ id: "prod-A", qty: 3 }]);
    const pending = makePending([
      {
        orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1",
        masterProductId: "prod-A", quantity: 3,
        promisedTo: "2026-12-05", createdAt: "2026-11-18T10:00:00Z",
      },
      {
        orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2",
        masterProductId: "prod-A", quantity: 3,
        promisedTo: "2026-12-05", createdAt: "2026-11-15T08:00:00Z",
      },
    ]);

    const plan = allocateStock(received, pending);

    // sh-2 has earlier createdAt → allocated first
    expect(plan.fullyAllocatedShipments).toContain("sh-2");
    expect(plan.unallocatedShipments).toContain("sh-1");
  });

  it("maximizes complete shipments (prefers full fill over partial splits)", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending = makePending([
      {
        orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1",
        masterProductId: "prod-A", quantity: 3,
        promisedTo: null, createdAt: "2026-11-10T10:00:00Z",
      },
      {
        orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2",
        masterProductId: "prod-A", quantity: 5,
        promisedTo: null, createdAt: "2026-11-11T10:00:00Z",
      },
    ]);

    const plan = allocateStock(received, pending);

    // sh-1 can be fully allocated (3 ≤ 5) → pass 1 allocates it
    expect(plan.fullyAllocatedShipments).toContain("sh-1");
    // sh-2 needs 5 but only 2 remain → partial in pass 2
    const sh2Alloc = plan.allocations.find((a) => a.shipmentId === "sh-2");
    expect(sh2Alloc!.allocatedQty).toBe(2);
    expect(plan.partiallyAllocatedShipments).toContain("sh-2");
  });
});

// ============================================================================
// F — Query failure (pure functions don't query; this tests error propagation
//     at the backend layer — validated by RPC RAISE EXCEPTION, not pure fn)
// ============================================================================
describe("F: Error handling in pure functions", () => {
  it("handles empty received array gracefully", () => {
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 3 },
    ]);

    const plan = allocateStock([], pending);

    expect(plan.allocations).toHaveLength(0);
    expect(plan.unallocatedShipments).toContain("sh-1");
    expect(plan.remainingStock.size).toBe(0);
  });

  it("handles product mismatch (pending asks for product not received)", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-B", quantity: 3 },
    ]);

    const plan = allocateStock(received, pending);

    expect(plan.allocations).toHaveLength(0);
    expect(plan.unallocatedShipments).toContain("sh-1");
    expect(plan.remainingStock.get("prod-A")).toBe(5);
  });
});

// ============================================================================
// G — Idempotency (calling allocateStock twice with same inputs → same result)
// ============================================================================
describe("G: Idempotency — same inputs produce same plan", () => {
  it("produces identical plan on repeated calls", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending = makePending([
      {
        orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1",
        masterProductId: "prod-A", quantity: 3,
        createdAt: "2026-11-10T10:00:00Z",
      },
      {
        orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2",
        masterProductId: "prod-A", quantity: 4,
        createdAt: "2026-11-11T10:00:00Z",
      },
    ]);

    const plan1 = allocateStock(received, pending);
    const plan2 = allocateStock(received, pending);

    expect(plan1.allocations.length).toBe(plan2.allocations.length);
    for (let i = 0; i < plan1.allocations.length; i++) {
      expect(plan1.allocations[i].orderItemId).toBe(plan2.allocations[i].orderItemId);
      expect(plan1.allocations[i].allocatedQty).toBe(plan2.allocations[i].allocatedQty);
    }
    expect(plan1.fullyAllocatedShipments).toEqual(plan2.fullyAllocatedShipments);
    expect(plan1.partiallyAllocatedShipments).toEqual(plan2.partiallyAllocatedShipments);
  });
});

// ============================================================================
// H — Over-allocation guard (allocateStock never allocates > available stock)
// ============================================================================
describe("H: Over-allocation guard", () => {
  it("never allocates more than available stock per product", () => {
    const received = makeReceived([
      { id: "prod-A", qty: 3 },
      { id: "prod-B", qty: 1 },
    ]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 10 },
      { orderItemId: "oi-2", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-B", quantity: 5 },
      { orderItemId: "oi-3", shipmentId: "sh-2", orderId: "ord-2", masterProductId: "prod-A", quantity: 7 },
    ]);

    const plan = allocateStock(received, pending);

    const totalAllocA = plan.allocations
      .filter((a) => a.masterProductId === "prod-A")
      .reduce((s, a) => s + a.allocatedQty, 0);
    const totalAllocB = plan.allocations
      .filter((a) => a.masterProductId === "prod-B")
      .reduce((s, a) => s + a.allocatedQty, 0);

    expect(totalAllocA).toBeLessThanOrEqual(3);
    expect(totalAllocB).toBeLessThanOrEqual(1);
    expect(plan.remainingStock.get("prod-A")).toBeGreaterThanOrEqual(0);
    expect(plan.remainingStock.get("prod-B")).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// I — Concurrency (pure functions are stateless; concurrency is RPC concern
//     via SELECT ... FOR UPDATE — this test validates no shared state mutation)
// ============================================================================
describe("I: No shared state mutation (concurrency safety)", () => {
  it("does not mutate the input received array", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const receivedCopy = JSON.parse(JSON.stringify(received));

    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 3 },
    ]);

    allocateStock(received, pending);

    expect(received).toEqual(receivedCopy);
  });

  it("does not mutate the input pending array", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 3 },
    ]);
    const pendingCopy = JSON.parse(JSON.stringify(pending));

    allocateStock(received, pending);

    expect(pending).toEqual(pendingCopy);
  });

  it("two parallel calls do not interfere (independent stock maps)", () => {
    const received = makeReceived([{ id: "prod-A", qty: 5 }]);
    const pending1 = makePending([
      { orderItemId: "oi-1", shipmentId: "sh-1", orderId: "ord-1", masterProductId: "prod-A", quantity: 3 },
    ]);
    const pending2 = makePending([
      { orderItemId: "oi-2", shipmentId: "sh-2", orderId: "ord-2", masterProductId: "prod-A", quantity: 4 },
    ]);

    const plan1 = allocateStock(received, pending1);
    const plan2 = allocateStock(received, pending2);

    // Each call sees full stock independently
    expect(plan1.allocations[0].allocatedQty).toBe(3);
    expect(plan2.allocations[0].allocatedQty).toBe(4);
    expect(plan1.remainingStock.get("prod-A")).toBe(2);
    expect(plan2.remainingStock.get("prod-A")).toBe(1);
  });
});
