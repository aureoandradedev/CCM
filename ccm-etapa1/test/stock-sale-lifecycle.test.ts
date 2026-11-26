// CCM — Bloco 1 V2, Etapa 5: Confirmação da venda + liberação/cancelamento + expiração.
// 16 mandatory tests covering sections A-G of the specification.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type StockReservation,
  type StockConfig,
  type CcmInventoryRow,
  type ConfirmResult,
  type ReleaseResult,
  DEFAULT_CONFIG,
} from "../src/regras2.ts";

import {
  decideSaleConfirmation,
  decideStockRelease,
  buildSaleMovements,
  classifyMixedOrder,
  confirmSale,
  releaseStock,
  expireLocks,
  canConfirmSale,
  canRescueExpiredSale,
  availabilityAfterConfirm,
} from "../src/regras5.ts";

// ─── Helpers ────────────────────────────────────────────────────────────

const ON: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 15 };
const OFF: StockConfig = { ...DEFAULT_CONFIG };

function makeReservation(
  overrides: Partial<StockReservation> & { masterProductId: string; orderId: string },
): StockReservation {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    orderItemId: `oi-${overrides.masterProductId}`,
    qty: 3,
    status: "reservation",
    lockedAt: null,
    lockExpiresAt: null,
    soldAt: null,
    releasedAt: null,
    ...overrides,
  };
}

const NOW = "2026-11-26T12:00:00Z";
const FUTURE = "2026-11-26T12:30:00Z";
const PAST = "2026-11-26T11:30:00Z";

// ═══════════════════════════════════════════════════════════════════════
// A. PAGAMENTO APROVADO — confirm_ccm_stock_sale
// ═══════════════════════════════════════════════════════════════════════

describe("A. Payment confirmed — confirm_ccm_stock_sale", () => {
  it("T1: promotes payment_lock → sold (happy path)", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 5,
      }),
    ];

    const { result, updatedReservations } = confirmSale("ord-1", res, ON, NOW);

    assert.equal(result.ok, true);
    assert.equal(result.soldCount, 5);
    assert.equal(updatedReservations[0].status, "sold");
    assert.equal(updatedReservations[0].soldAt, NOW);
  });

  it("T2: idempotent — double call safe (already sold stays sold)", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: PAST,
        qty: 5,
      }),
    ];

    const { result, updatedReservations } = confirmSale("ord-1", res, ON, NOW);

    assert.equal(result.soldCount, 0);
    assert.equal(result.releasedCount, 0);
    assert.equal(updatedReservations[0].status, "sold");
    assert.equal(updatedReservations[0].soldAt, PAST);
  });

  it("T3: flag OFF → skipped, no promotion", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 5,
      }),
    ];

    const { result, updatedReservations } = confirmSale("ord-1", res, OFF, NOW);

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "ccm_stock_disabled");
    assert.equal(result.soldCount, 0);
    assert.equal(updatedReservations[0].status, "payment_lock");
  });

  it("T4: no double deduction — sold qty matches locked qty exactly", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 3,
      }),
      makeReservation({
        masterProductId: "mp-2",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 2,
      }),
    ];

    const { result } = confirmSale("ord-1", res, ON, NOW);

    assert.equal(result.soldCount, 5);
    assert.equal(result.releasedCount, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// B. CANCELAMENTO — release_ccm_stock in all cancel paths
// ═══════════════════════════════════════════════════════════════════════

describe("B. Cancellation — release_ccm_stock", () => {
  it("T5: customer cancel releases reservation + payment_lock", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "reservation",
        qty: 3,
      }),
      makeReservation({
        masterProductId: "mp-2",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 2,
      }),
    ];

    const { result, updatedReservations } = releaseStock("ord-1", res, ON, NOW);

    assert.equal(result.releasedCount, 5);
    assert.equal(updatedReservations[0].status, "released");
    assert.equal(updatedReservations[1].status, "released");
  });

  it("T6: admin cancel releases same as customer cancel", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 4,
      }),
    ];

    const { result } = releaseStock("ord-1", res, ON, NOW);
    assert.equal(result.releasedCount, 4);
  });

  it("T7: timeout cancel (cleanup) releases locks", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "reservation",
        qty: 2,
      }),
    ];

    const { result } = releaseStock("ord-1", res, ON, NOW);
    assert.equal(result.releasedCount, 2);
  });

  it("T8: flag OFF → skipped, no release", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 3,
      }),
    ];

    const { result, updatedReservations } = releaseStock("ord-1", res, OFF, NOW);
    assert.equal(result.skipped, true);
    assert.equal(updatedReservations[0].status, "payment_lock");
  });

  it("T9: never release sold items", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: PAST,
        qty: 5,
      }),
      makeReservation({
        masterProductId: "mp-2",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 2,
      }),
    ];

    const { result, updatedReservations } = releaseStock("ord-1", res, ON, NOW);

    assert.equal(result.releasedCount, 2);
    assert.equal(updatedReservations[0].status, "sold");
    assert.equal(updatedReservations[0].soldAt, PAST);
    assert.equal(updatedReservations[1].status, "released");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C. EXPIRAÇÃO — expire_payment_locks
// ═══════════════════════════════════════════════════════════════════════

describe("C. Expiration — expire_payment_locks", () => {
  it("T10: expired lock → released, quantity returns to availability", () => {
    const inventory: CcmInventoryRow[] = [{ masterProductId: "mp-1", quantity: 10 }];
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: "2026-11-26T10:00:00Z",
        lockExpiresAt: PAST,
        qty: 3,
      }),
    ];

    const { result, updatedReservations } = expireLocks(res, NOW);
    assert.equal(result.expiredCount, 3);
    assert.equal(updatedReservations[0].status, "released");

    const avail = availabilityAfterConfirm(inventory, updatedReservations, NOW);
    assert.equal(avail[0].disponivel, 10);
    assert.equal(avail[0].travados, 0);
  });

  it("T11: non-expired lock stays active, not released", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: NOW,
        lockExpiresAt: FUTURE,
        qty: 3,
      }),
    ];

    const { result, updatedReservations } = expireLocks(res, NOW);
    assert.equal(result.expiredCount, 0);
    assert.equal(updatedReservations[0].status, "payment_lock");
  });

  it("T12: sold items untouched by expiration", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: PAST,
        qty: 3,
      }),
    ];

    const { result, updatedReservations } = expireLocks(res, NOW);
    assert.equal(result.expiredCount, 0);
    assert.equal(updatedReservations[0].status, "sold");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// D. CORRIDA PAGAMENTO × EXPIRAÇÃO — atomic guarantee
// ═══════════════════════════════════════════════════════════════════════

describe("D. Race condition — payment × expiration", () => {
  it("T13: payment confirms BEFORE expiration → sold wins, cron gets 0", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 5,
      }),
    ];

    // Step 1: webhook confirms payment
    const { result: confirmResult, updatedReservations: afterConfirm } =
      confirmSale("ord-1", res, ON, NOW);
    assert.equal(confirmResult.soldCount, 5);
    assert.equal(afterConfirm[0].status, "sold");

    // Step 2: cron runs — sold items untouched
    const { result: expireResult, updatedReservations: afterExpire } =
      expireLocks(afterConfirm, FUTURE);
    assert.equal(expireResult.expiredCount, 0);
    assert.equal(afterExpire[0].status, "sold");
  });

  it("T13b: payment AFTER lock expiry → not rescued, confirm gets 0 sold", () => {
    const LOCK_EXPIRED = "2026-11-26T11:45:00Z";
    const CRON_TIME = "2026-11-26T11:46:00Z";
    const WEBHOOK_TIME = "2026-11-26T11:47:00Z";
    // Customer paid AFTER lock expired — this is a late payment, not a race
    const PAID_AT = "2026-11-26T11:46:30Z";

    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: "2026-11-26T11:30:00Z",
        lockExpiresAt: LOCK_EXPIRED,
        qty: 5,
      }),
    ];

    // Step 1: cron expires the lock
    const { result: expireResult, updatedReservations: afterExpire } =
      expireLocks(res, CRON_TIME);
    assert.equal(expireResult.expiredCount, 5);
    assert.equal(afterExpire[0].status, "released");

    // Step 2: webhook with paidAt AFTER lock expiry — no rescue
    const { result: confirmResult, updatedReservations: afterConfirm } =
      confirmSale("ord-1", afterExpire, ON, WEBHOOK_TIME, PAID_AT);
    assert.equal(confirmResult.soldCount, 0);
    assert.equal(confirmResult.rescuedCount, 0);
    assert.equal(afterConfirm[0].status, "released");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// E. MOVIMENTOS — CCM sold = direct sale movement
// ═══════════════════════════════════════════════════════════════════════

describe("E. Inventory movements — CCM direct sale", () => {
  it("T14: sold items generate sale_from_stock movements", () => {
    const soldReservations: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: NOW,
        qty: 3,
      }),
      makeReservation({
        masterProductId: "mp-2",
        orderId: "ord-1",
        status: "sold",
        soldAt: NOW,
        qty: 2,
      }),
    ];
    const costMap = new Map([
      ["mp-1", 1500],
      ["mp-2", 2000],
    ]);

    const movements = buildSaleMovements(soldReservations, costMap, "ord-1");

    assert.equal(movements.length, 2);

    const m1 = movements.find((m) => m.masterProductId === "mp-1")!;
    assert.equal(m1.movementType, "sale_from_stock");
    assert.equal(m1.quantity, -3);
    assert.equal(m1.unitCostCentavos, 1500);
    assert.equal(m1.sourceOrderId, "ord-1");
    assert.equal(m1.reason, "ccm_direct_sale");

    const m2 = movements.find((m) => m.masterProductId === "mp-2")!;
    assert.equal(m2.quantity, -2);
    assert.equal(m2.unitCostCentavos, 2000);
  });

  it("T14b: same master_product across multiple reservations → per-reservation movements (not aggregated)", () => {
    const soldReservations: StockReservation[] = [
      makeReservation({
        id: "r-first",
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-mp-1-a",
        status: "sold",
        soldAt: NOW,
        qty: 2,
      }),
      makeReservation({
        id: "r-extra",
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-mp-1-b",
        status: "sold",
        soldAt: NOW,
        qty: 1,
      }),
    ];
    const costMap = new Map([["mp-1", 1000]]);

    const movements = buildSaleMovements(soldReservations, costMap, "ord-1");

    // 0065: per-reservation — 2 movements, not 1 aggregated
    assert.equal(movements.length, 2);
    assert.equal(movements[0].quantity, -2);
    assert.equal(movements[0].reservationId, "r-first");
    assert.equal(movements[1].quantity, -1);
    assert.equal(movements[1].reservationId, "r-extra");
    // Total still correct
    assert.equal(movements.reduce((s, m) => s + m.quantity, 0), -3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F. PEDIDO MISTO — CCM sold + supplier items
// ═══════════════════════════════════════════════════════════════════════

describe("F. Mixed order — CCM + supplier", () => {
  it("T15: 1 CCM sold + 2 supplier → correct classification", () => {
    const reservations: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-1",
        status: "sold",
        soldAt: NOW,
        qty: 3,
      }),
    ];

    const orderItems = [
      { orderItemId: "oi-1", masterProductId: "mp-1", qty: 3, supplierId: "sup-1" },
      { orderItemId: "oi-2", masterProductId: null, qty: 5, supplierId: "sup-2" },
      { orderItemId: "oi-3", masterProductId: null, qty: 2, supplierId: "sup-2" },
    ];

    const result = classifyMixedOrder(reservations, orderItems);

    assert.equal(result.ccmCount, 1);
    assert.equal(result.supplierCount, 2);
    assert.equal(result.totalItems, 3);
    assert.equal(result.ccmSoldItems[0].orderItemId, "oi-1");
    assert.equal(result.supplierItems.length, 2);
    assert.equal(result.supplierItems[0].orderItemId, "oi-2");
    assert.equal(result.supplierItems[1].orderItemId, "oi-3");
  });

  it("T16: total stays correct — no duplicity between CCM and supplier", () => {
    const reservations: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-1",
        status: "sold",
        soldAt: NOW,
        qty: 3,
      }),
    ];

    const orderItems = [
      { orderItemId: "oi-1", masterProductId: "mp-1", qty: 3, supplierId: "sup-1" },
      { orderItemId: "oi-2", masterProductId: null, qty: 5, supplierId: "sup-2" },
      { orderItemId: "oi-3", masterProductId: null, qty: 2, supplierId: "sup-2" },
    ];

    const result = classifyMixedOrder(reservations, orderItems);

    // CCM items + supplier items = total items (no overlap)
    assert.equal(result.ccmCount + result.supplierCount, result.totalItems);

    // CCM-sold item is NOT in supplier items
    const ccmItemIds = new Set(result.ccmSoldItems.map((r) => r.orderItemId));
    for (const si of result.supplierItems) {
      assert.equal(ccmItemIds.has(si.orderItemId), false, `${si.orderItemId} appears in both CCM and supplier`);
    }

    // Build movements — only CCM items get sale_from_stock
    const costMap = new Map([["mp-1", 1500]]);
    const movements = buildSaleMovements(result.ccmSoldItems, costMap, "ord-1");
    assert.equal(movements.length, 1);
    assert.equal(movements[0].quantity, -3);

    // Supplier items have total qty = 5 + 2 = 7, CCM = 3, grand total = 10
    const supplierQty = result.supplierItems.reduce((s, i) => s + i.qty, 0);
    const ccmQty = result.ccmSoldItems.reduce((s, r) => s + r.qty, 0);
    assert.equal(supplierQty + ccmQty, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// G. Decision functions — decideSaleConfirmation / decideStockRelease
// ═══════════════════════════════════════════════════════════════════════

describe("G. Decision functions", () => {
  it("decideSaleConfirmation: flag OFF → skipped", () => {
    const d = decideSaleConfirmation(null, OFF);
    assert.equal(d.action, "skipped");
  });

  it("decideSaleConfirmation: sold + released → confirm", () => {
    const r: ConfirmResult = { ok: true, soldCount: 3, releasedCount: 1 };
    const d = decideSaleConfirmation(r, ON);
    assert.equal(d.action, "confirm");
    assert.equal(d.soldCount, 3);
    assert.equal(d.releasedCount, 1);
  });

  it("decideSaleConfirmation: 0 sold + 0 released → no_locks", () => {
    const r: ConfirmResult = { ok: true, soldCount: 0, releasedCount: 0 };
    const d = decideSaleConfirmation(r, ON);
    assert.equal(d.action, "no_locks");
  });

  it("decideStockRelease: flag OFF → skipped", () => {
    const d = decideStockRelease(null, OFF);
    assert.equal(d.action, "skipped");
  });

  it("decideStockRelease: released > 0 → released", () => {
    const r: ReleaseResult = { ok: true, releasedCount: 4 };
    const d = decideStockRelease(r, ON);
    assert.equal(d.action, "released");
    assert.equal(d.releasedCount, 4);
  });

  it("decideStockRelease: 0 released → nothing_to_release", () => {
    const r: ReleaseResult = { ok: true, releasedCount: 0 };
    const d = decideStockRelease(r, ON);
    assert.equal(d.action, "nothing_to_release");
  });

  it("canConfirmSale: active lock → true", () => {
    const r = makeReservation({
      masterProductId: "mp-1",
      orderId: "ord-1",
      status: "payment_lock",
      lockedAt: PAST,
      lockExpiresAt: FUTURE,
    });
    assert.equal(canConfirmSale(r, NOW), true);
  });

  it("canConfirmSale: expired lock → false", () => {
    const r = makeReservation({
      masterProductId: "mp-1",
      orderId: "ord-1",
      status: "payment_lock",
      lockedAt: "2026-11-26T10:00:00Z",
      lockExpiresAt: PAST,
    });
    assert.equal(canConfirmSale(r, NOW), false);
  });

  it("canConfirmSale: reservation (not locked) → false", () => {
    const r = makeReservation({
      masterProductId: "mp-1",
      orderId: "ord-1",
      status: "reservation",
    });
    assert.equal(canConfirmSale(r, NOW), false);
  });

  it("availabilityAfterConfirm: sold reduces fisico-pagos correctly", () => {
    const inventory: CcmInventoryRow[] = [
      { masterProductId: "mp-1", quantity: 10 },
    ];
    const reservations: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: NOW,
        qty: 3,
      }),
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-2",
        status: "payment_lock",
        lockedAt: NOW,
        lockExpiresAt: FUTURE,
        qty: 2,
      }),
    ];

    const avail = availabilityAfterConfirm(inventory, reservations, NOW);
    assert.equal(avail[0].fisico, 10);
    assert.equal(avail[0].pagos, 3);
    assert.equal(avail[0].travados, 2);
    assert.equal(avail[0].disponivel, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// H. 0065 CORRECTIONS — race, atomicity, idempotency, granularity
// ═══════════════════════════════════════════════════════════════════════

describe("H. Correction tests (0065)", () => {

  // H1: Pix paid before expiry, webhook arrives after cron expired the lock
  it("H1: webhook delay — payment before expiry, cron expires, confirm rescues", () => {
    const LOCK_EXPIRES = "2026-11-26T12:15:00Z";
    const PAID_AT      = "2026-11-26T12:14:58Z"; // customer paid 2s before lock expiry
    const CRON_TIME    = "2026-11-26T12:15:00Z";
    const WEBHOOK_TIME = "2026-11-26T12:15:03Z"; // webhook arrives 3s after expiry

    const inventory: CcmInventoryRow[] = [{ masterProductId: "mp-1", quantity: 10 }];
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: "2026-11-26T12:00:00Z",
        lockExpiresAt: LOCK_EXPIRES,
        qty: 5,
      }),
    ];

    // Step 1: cron expires the lock
    const { updatedReservations: afterExpire } = expireLocks(res, CRON_TIME);
    assert.equal(afterExpire[0].status, "released");

    // Step 2: webhook confirms — with paidAt, the rescue kicks in
    const { result, updatedReservations: afterConfirm } =
      confirmSale("ord-1", afterExpire, ON, WEBHOOK_TIME, PAID_AT, inventory);

    assert.equal(result.soldCount, 1); // rescue succeeded (1 reservation)
    assert.equal(result.rescuedCount, 1);
    assert.equal(afterConfirm[0].status, "sold");
  });

  // H2: Pix paid AFTER lock expiry → no rescue, rescue_failed
  it("H2: payment after lock expiry → not rescued", () => {
    const LOCK_EXPIRES = "2026-11-26T12:15:00Z";
    const PAID_AT      = "2026-11-26T12:16:00Z"; // customer paid 1 min AFTER lock expired

    const inventory: CcmInventoryRow[] = [{ masterProductId: "mp-1", quantity: 10 }];
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "released",
        releasedAt: "2026-11-26T12:15:00Z",
        lockExpiresAt: LOCK_EXPIRES,
        qty: 5,
      }),
    ];

    const { result, updatedReservations } =
      confirmSale("ord-1", res, ON, "2026-11-26T12:17:00Z", PAID_AT, inventory);

    assert.equal(result.soldCount, 0);
    assert.equal(result.rescuedCount, 0);
    assert.equal(updatedReservations[0].status, "released");
  });

  // H3: Simultaneous cron + confirm — confirm on active lock wins, cron gets 0
  it("H3: simultaneous cron + confirm — confirm on active lock wins", () => {
    const LOCK_EXPIRES = "2026-11-26T12:15:00Z";
    const RACE_TIME    = "2026-11-26T12:14:59Z"; // 1s before expiry

    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: "2026-11-26T12:00:00Z",
        lockExpiresAt: LOCK_EXPIRES,
        qty: 5,
      }),
    ];

    // Both run at ~same time, but confirm runs first (lock still active)
    const { result: confirmResult, updatedReservations: afterConfirm } =
      confirmSale("ord-1", res, ON, RACE_TIME);

    assert.equal(confirmResult.soldCount, 5);
    assert.equal(afterConfirm[0].status, "sold");

    // Cron runs immediately after — sold items are untouched
    const { result: expireResult } = expireLocks(afterConfirm, LOCK_EXPIRES);
    assert.equal(expireResult.expiredCount, 0);
  });

  // H4: Failure between promotion and movement → retry produces exactly 1 sale + 1 movement
  it("H4: simulated crash between promote and movement — retry is safe", () => {
    const res: StockReservation[] = [
      makeReservation({
        id: "r-crash-test",
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 3,
      }),
    ];
    const costMap = new Map([["mp-1", 1500]]);

    // First call: confirms sale
    const { result: r1, updatedReservations: after1 } = confirmSale("ord-1", res, ON, NOW);
    assert.equal(r1.soldCount, 3);

    // Build movements from sold
    const sold1 = after1.filter((r) => r.status === "sold");
    const movements1 = buildSaleMovements(sold1, costMap, "ord-1");
    assert.equal(movements1.length, 1);
    assert.equal(movements1[0].reservationId, "r-crash-test");

    // Retry: second call does NOT re-promote (already sold)
    const { result: r2, updatedReservations: after2 } = confirmSale("ord-1", after1, ON, NOW);
    assert.equal(r2.soldCount, 0); // nothing new promoted
    assert.equal(after2[0].status, "sold"); // stays sold

    // Movements from second attempt: same sold rows, same reservation IDs
    const sold2 = after2.filter((r) => r.status === "sold");
    const movements2 = buildSaleMovements(sold2, costMap, "ord-1");
    assert.equal(movements2.length, 1);
    // Same reservation ID → DB unique index prevents duplicate INSERT
    assert.equal(movements2[0].reservationId, "r-crash-test");
  });

  // H5: Retry after partial failure — idempotent result
  it("H5: retry after failure — idempotent, no duplicate movements", () => {
    const res: StockReservation[] = [
      makeReservation({
        id: "r-retry-1",
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "sold",
        soldAt: PAST,
        qty: 3,
      }),
    ];
    const costMap = new Map([["mp-1", 1500]]);

    // Both calls produce the same movement with same reservationId
    const m1 = buildSaleMovements(res, costMap, "ord-1");
    const m2 = buildSaleMovements(res, costMap, "ord-1");

    assert.equal(m1.length, 1);
    assert.equal(m2.length, 1);
    assert.equal(m1[0].reservationId, m2[0].reservationId);
    // DB unique index on source_reservation_id WHERE sale_from_stock → ON CONFLICT DO NOTHING
  });

  // H6: Duplicate webhook — second confirmSale returns 0 sold
  it("H6: duplicate webhook — second confirm is no-op", () => {
    const res: StockReservation[] = [
      makeReservation({
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 5,
      }),
    ];

    // First webhook
    const { result: r1, updatedReservations: after1 } = confirmSale("ord-1", res, ON, NOW);
    assert.equal(r1.soldCount, 5);

    // Duplicate webhook — already sold, nothing to promote
    const { result: r2, updatedReservations: after2 } = confirmSale("ord-1", after1, ON, NOW);
    assert.equal(r2.soldCount, 0);
    assert.equal(r2.releasedCount, 0);
    assert.equal(after2[0].status, "sold");
    assert.equal(after2[0].soldAt, NOW); // stays from first call
  });

  // H7: Two order lines with same master_product → separate movements per reservation
  it("H7: two lines same master_product → one movement per reservation", () => {
    const soldReservations: StockReservation[] = [
      makeReservation({
        id: "r-line-a",
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-1",
        status: "sold",
        soldAt: NOW,
        qty: 2,
      }),
      makeReservation({
        id: "r-line-b",
        masterProductId: "mp-1",
        orderId: "ord-1",
        orderItemId: "oi-2",
        status: "sold",
        soldAt: NOW,
        qty: 3,
      }),
    ];
    const costMap = new Map([["mp-1", 1000]]);

    const movements = buildSaleMovements(soldReservations, costMap, "ord-1");

    assert.equal(movements.length, 2);
    assert.equal(movements[0].reservationId, "r-line-a");
    assert.equal(movements[0].quantity, -2);
    assert.equal(movements[1].reservationId, "r-line-b");
    assert.equal(movements[1].quantity, -3);

    // Each has distinct reservationId → unique index satisfied
    const reservationIds = movements.map((m) => m.reservationId);
    assert.equal(new Set(reservationIds).size, 2);
  });

  // H8: Exactly one movement per logical sale
  it("H8: exactly one movement per sold reservation", () => {
    const soldReservations: StockReservation[] = [
      makeReservation({ id: "r-a", masterProductId: "mp-1", orderId: "ord-1", status: "sold", soldAt: NOW, qty: 1 }),
      makeReservation({ id: "r-b", masterProductId: "mp-2", orderId: "ord-1", status: "sold", soldAt: NOW, qty: 2 }),
      makeReservation({ id: "r-c", masterProductId: "mp-1", orderId: "ord-1", orderItemId: "oi-mp-1-b", status: "sold", soldAt: NOW, qty: 3 }),
    ];
    const costMap = new Map([["mp-1", 100], ["mp-2", 200]]);

    const movements = buildSaleMovements(soldReservations, costMap, "ord-1");

    // 3 sold reservations → 3 movements (not 2 aggregated by product)
    assert.equal(movements.length, 3);
    assert.deepEqual(
      movements.map((m) => m.reservationId).sort(),
      ["r-a", "r-b", "r-c"],
    );
  });

  // H9: No sale without movement — sold count must equal movement count
  it("H9: no sale without movement — sold count matches movements", () => {
    const res: StockReservation[] = [
      makeReservation({
        id: "r-1",
        masterProductId: "mp-1",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 3,
      }),
      makeReservation({
        id: "r-2",
        masterProductId: "mp-2",
        orderId: "ord-1",
        status: "payment_lock",
        lockedAt: PAST,
        lockExpiresAt: FUTURE,
        qty: 2,
      }),
    ];
    const costMap = new Map([["mp-1", 100], ["mp-2", 200]]);

    const { updatedReservations } = confirmSale("ord-1", res, ON, NOW);
    const soldRows = updatedReservations.filter((r) => r.status === "sold");
    const movements = buildSaleMovements(soldRows, costMap, "ord-1");

    // Every sold reservation has exactly one movement
    assert.equal(soldRows.length, movements.length);
    for (const sold of soldRows) {
      const m = movements.find((mv) => mv.reservationId === sold.id);
      assert.ok(m, `Missing movement for reservation ${sold.id}`);
      assert.equal(m!.quantity, -sold.qty);
    }
  });

  // H10: Consistent final balance — sold quantities match movement totals
  it("H10: consistent balance — sum of movements equals sum of sold qty", () => {
    const inventory: CcmInventoryRow[] = [
      { masterProductId: "mp-1", quantity: 20 },
      { masterProductId: "mp-2", quantity: 15 },
    ];
    const res: StockReservation[] = [
      makeReservation({ id: "r-a", masterProductId: "mp-1", orderId: "ord-1", status: "payment_lock", lockedAt: PAST, lockExpiresAt: FUTURE, qty: 5 }),
      makeReservation({ id: "r-b", masterProductId: "mp-2", orderId: "ord-1", status: "payment_lock", lockedAt: PAST, lockExpiresAt: FUTURE, qty: 3 }),
      makeReservation({ id: "r-c", masterProductId: "mp-1", orderId: "ord-1", orderItemId: "oi-mp-1-b", status: "payment_lock", lockedAt: PAST, lockExpiresAt: FUTURE, qty: 2 }),
    ];
    const costMap = new Map([["mp-1", 1000], ["mp-2", 2000]]);

    const { result, updatedReservations } = confirmSale("ord-1", res, ON, NOW);
    const soldRows = updatedReservations.filter((r) => r.status === "sold");
    const movements = buildSaleMovements(soldRows, costMap, "ord-1");

    // Total sold qty
    const totalSoldQty = soldRows.reduce((s, r) => s + r.qty, 0);
    assert.equal(totalSoldQty, 10); // 5 + 3 + 2

    // Total movement deduction
    const totalDeducted = movements.reduce((s, m) => s + m.quantity, 0);
    assert.equal(totalDeducted, -10); // matches sold qty

    // Result sold_count is qty sum, not row count
    assert.equal(result.soldCount, 10);

    // Per-product balance check
    const mp1Sold = soldRows.filter((r) => r.masterProductId === "mp-1").reduce((s, r) => s + r.qty, 0);
    const mp1Movements = movements.filter((m) => m.masterProductId === "mp-1").reduce((s, m) => s + m.quantity, 0);
    assert.equal(mp1Sold, 7); // 5 + 2
    assert.equal(mp1Movements, -7);

    // After confirm: availability = fisico - pagos
    const avail = availabilityAfterConfirm(inventory, updatedReservations, NOW);
    const mp1Avail = avail.find((a) => a.masterProductId === "mp-1")!;
    assert.equal(mp1Avail.fisico, 20);
    assert.equal(mp1Avail.pagos, 7);
    assert.equal(mp1Avail.disponivel, 13); // 20 - 7
  });
});
