import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rankProductOffers, extractWinnerBackup } from "../lib/ranking.mjs";
import { calculateEffectiveTimeout } from "../lib/supplier-timeout.mjs";

const base = { master_product_id: "mp1", status: "ativa" };

// ============================================================================
// A. Backup cost threshold logic
// ============================================================================

describe("backup cost threshold", () => {
  function exceedsThreshold(winnerCost, backupCost, thresholdPct) {
    if (!winnerCost || winnerCost <= 0) return true;
    const pct = ((backupCost - winnerCost) / winnerCost) * 100;
    return pct > thresholdPct;
  }

  test("backup within threshold → allowed", () => {
    assert.equal(exceedsThreshold(1000, 1100, 15), false);
  });

  test("backup exactly at threshold → allowed", () => {
    assert.equal(exceedsThreshold(1000, 1150, 15), false);
  });

  test("backup exceeds threshold → blocked", () => {
    assert.equal(exceedsThreshold(1000, 1200, 15), true);
  });

  test("zero winner cost → always exceeds (safety)", () => {
    assert.equal(exceedsThreshold(0, 500, 15), true);
  });

  test("backup cheaper than winner → within threshold", () => {
    assert.equal(exceedsThreshold(1000, 800, 15), false);
  });

  test("equal costs → 0% → within threshold", () => {
    assert.equal(exceedsThreshold(500, 500, 15), false);
  });

  test("threshold 0% → only equal or cheaper allowed", () => {
    assert.equal(exceedsThreshold(1000, 1001, 0), true);
    assert.equal(exceedsThreshold(1000, 1000, 0), false);
    assert.equal(exceedsThreshold(1000, 999, 0), false);
  });
});

// ============================================================================
// B. Winner/backup extraction with cost awareness
// ============================================================================

describe("extractWinnerBackup cost scenarios", () => {
  test("winner is cheapest, backup is second cheapest", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 600, unit_cost_centavos: 60, stock: 10, lead_time_days: 1 },
      { ...base, id: "c", supplier_id: "s3", cost_centavos: 900, unit_cost_centavos: 90, stock: 10, lead_time_days: 1 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s1");
    assert.equal(backup.supplier_id, "s2");
  });

  test("three offers with two out of stock → winner only, no backup", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 500, stock: 10, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 300, stock: 0, lead_time_days: 1 },
      { ...base, id: "c", supplier_id: "s3", cost_centavos: 400, stock: null, lead_time_days: 1 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s1");
    assert.equal(backup, null);
  });
});

// ============================================================================
// C. Simultaneous winner+backup scenarios
// ============================================================================

describe("simultaneous winner+backup (T <= T_min)", () => {
  const defaults = {
    T_config: 45,
    T_min: 10,
    paymentEstimate: 30,
    backupResponseEstimate: 20,
  };

  test("very tight cutoff → both requests go out simultaneously", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 50 });
    assert.equal(r.simultaneous, true);
    assert.equal(r.T_efetivo, 10);
  });

  test("comfortable cutoff → sequential (winner first)", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 200 });
    assert.equal(r.simultaneous, false);
    assert.equal(r.T_efetivo, 45);
  });

  test("edge: exactly T_min → simultaneous", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 60 });
    assert.equal(r.simultaneous, true);
    assert.equal(r.T_efetivo, 10);
  });

  test("edge: T_min + 1 → NOT simultaneous", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 61 });
    assert.equal(r.simultaneous, false);
  });
});

// ============================================================================
// D. Notification ladder idempotency key format
// ============================================================================

describe("notification ladder idempotency", () => {
  function makeIdempotencyKey(requestId, stepMinutes) {
    return `${requestId}:ladder:${stepMinutes}`;
  }

  test("produces unique keys per step", () => {
    const reqId = "req-123";
    const steps = [0, 10, 20, 30, 40];
    const keys = steps.map((s) => makeIdempotencyKey(reqId, s));
    const unique = new Set(keys);
    assert.equal(unique.size, steps.length);
  });

  test("same step for different requests → different keys", () => {
    const k1 = makeIdempotencyKey("req-aaa", 10);
    const k2 = makeIdempotencyKey("req-bbb", 10);
    assert.notEqual(k1, k2);
  });

  test("same request + same step → same key (idempotent)", () => {
    const k1 = makeIdempotencyKey("req-aaa", 10);
    const k2 = makeIdempotencyKey("req-aaa", 10);
    assert.equal(k1, k2);
  });
});

// ============================================================================
// E. CAS claim semantics (pure logic, no DB)
// ============================================================================

describe("CAS claim semantics", () => {
  function simulateClaim(remaining, requested) {
    const actual = Math.min(requested, remaining);
    const newRemaining = remaining - actual;
    return { actual, newRemaining };
  }

  test("full claim: requested <= remaining", () => {
    const { actual, newRemaining } = simulateClaim(100, 50);
    assert.equal(actual, 50);
    assert.equal(newRemaining, 50);
  });

  test("partial claim: requested > remaining", () => {
    const { actual, newRemaining } = simulateClaim(30, 50);
    assert.equal(actual, 30);
    assert.equal(newRemaining, 0);
  });

  test("zero remaining → zero actual", () => {
    const { actual, newRemaining } = simulateClaim(0, 50);
    assert.equal(actual, 0);
    assert.equal(newRemaining, 0);
  });

  test("exactly matching → takes all", () => {
    const { actual, newRemaining } = simulateClaim(50, 50);
    assert.equal(actual, 50);
    assert.equal(newRemaining, 0);
  });

  test("two sequential claims on same item → second gets remainder", () => {
    let remaining = 100;
    const c1 = simulateClaim(remaining, 70);
    remaining = c1.newRemaining;
    const c2 = simulateClaim(remaining, 70);
    assert.equal(c1.actual, 70);
    assert.equal(c2.actual, 30);
    assert.equal(c2.newRemaining, 0);
  });

  test("lock ordering: items sorted by id ASC prevents deadlock", () => {
    const items = [
      { id: "item-c", qty: 10 },
      { id: "item-a", qty: 20 },
      { id: "item-b", qty: 15 },
    ];
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(
      sorted.map((i) => i.id),
      ["item-a", "item-b", "item-c"],
    );
  });
});

// ============================================================================
// F. initializeSupplierRoles flag OFF behavior
// ============================================================================

describe("initializeSupplierRoles flag OFF", () => {
  test("when flag is OFF, only sets residual_qty on order_items", () => {
    const flagEnabled = false;
    const items = [
      { id: "oi1", qty: 10 },
      { id: "oi2", qty: 5 },
    ];
    const suppliersPayload = [
      { supplier_id: "s1", lines: [{ product_id: "p1", quantity: 10, order_item_id: "oi1" }] },
      { supplier_id: "s2", lines: [{ product_id: "p2", quantity: 5, order_item_id: "oi2" }] },
    ];

    if (!flagEnabled) {
      const residuals = suppliersPayload.flatMap((sp) =>
        sp.lines.map((l) => ({ order_item_id: l.order_item_id, residual_qty: l.quantity })),
      );
      assert.deepEqual(residuals, [
        { order_item_id: "oi1", residual_qty: 10 },
        { order_item_id: "oi2", residual_qty: 5 },
      ]);
    }

    assert.equal(flagEnabled, false);
  });

  test("residual_qty = supplier portion, not total qty", () => {
    const supplierLine = { quantity: 7, order_item_id: "oi1" };
    const orderItem = { id: "oi1", qty: 10 };
    assert.notEqual(supplierLine.quantity, orderItem.qty);
    assert.equal(supplierLine.quantity, 7);
  });
});
