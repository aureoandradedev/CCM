// CCM — Bloco 1 V2, Etapa 4: Trava atômica de estoque CCM no pagamento.
// Tests for pure functions (regras4.ts) covering all 16 mandatory scenarios.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decidePaymentLockAction,
  validatePixTtl,
  buildShortfallSupplierPayload,
  shouldBypassGate,
  hasActiveCcmReservations,
  PIX_TTL_SAFETY_MARGIN_SECONDS,
  MIN_SAFE_PIX_SECONDS,
  type PaymentLockDecision,
  type PixTtlValidation,
} from "../src/regras4.ts";

import {
  type StockConfig,
  type LockResult,
  type LockSummary,
  DEFAULT_CONFIG,
} from "../src/regras2.ts";

import { type OrderItem } from "../src/regras3.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────

const ON: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 15 };
const OFF: StockConfig = { ccmStockEnabled: false, paymentLockTtlMinutes: 15 };

function makeLockSummary(overrides: Partial<LockSummary> = {}): LockSummary {
  return {
    ok: true,
    travado: 10,
    faltou: 0,
    expiresAt: "2026-12-01T00:15:00Z",
    details: [],
    ...overrides,
  };
}

function makeOrderItems(): OrderItem[] {
  return [
    {
      product_id: "prod-1",
      supplier_id: "sup-a",
      master_product_id: "mp-1",
      name: "Cimento 50kg",
      qty: 10,
      unit: "un",
      supplier_cost_centavos: 2500,
      unit_price_centavos: 3500,
    },
    {
      product_id: "prod-2",
      supplier_id: "sup-b",
      master_product_id: "mp-2",
      name: "Argamassa 20kg",
      qty: 5,
      unit: "un",
      supplier_cost_centavos: 1500,
      unit_price_centavos: 2000,
    },
  ];
}

// ─── T1: Flag OFF → decidePaymentLockAction returns 'disabled' ──────────

describe("Etapa 4 — Payment lock pure functions", () => {
  it("T1: flag OFF → action is disabled, no lock attempted", () => {
    const decision = decidePaymentLockAction(null, OFF);
    assert.equal(decision.action, "disabled");
    assert.equal(decision.reason, "ccm_stock_disabled");
    assert.equal(decision.travado, 0);
    assert.equal(decision.faltou, 0);
  });

  // ─── T2: Flag ON, all locked → action is 'proceed' ──────────────────

  it("T2: flag ON + all locked → proceed", () => {
    const lock = makeLockSummary({ travado: 10, faltou: 0, details: [] });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "proceed");
    assert.equal(decision.reason, "all_locked");
    assert.equal(decision.travado, 10);
    assert.equal(decision.faltou, 0);
  });

  // ─── T3: Flag ON, shortfall → action is 'shortfall_needs_confirmation'

  it("T3: flag ON + shortfall → shortfall_needs_confirmation", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 7, faltou: 3 },
    ];
    const lock = makeLockSummary({ travado: 7, faltou: 3, details });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "shortfall_needs_confirmation");
    assert.equal(decision.reason, "ccm_stock_insufficient");
    assert.equal(decision.faltou, 3);
    assert.equal(decision.shortfallDetails.length, 1);
    assert.equal(decision.shortfallDetails[0].faltou, 3);
  });

  // ─── T4: Flag ON, lock failed (ok=false) → action is 'error' ─────────

  it("T4: flag ON + lock failed → error", () => {
    const lock: LockSummary = {
      ok: false,
      travado: 0,
      faltou: 0,
      expiresAt: null,
      details: [],
    };
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "error");
    assert.equal(decision.reason, "lock_failed");
  });

  // ─── T5: Idempotent — already locked → proceed ───────────────────────

  it("T5: already locked (idempotent) → proceed", () => {
    const lock = makeLockSummary({
      skipped: true,
      reason: "already_locked",
      travado: 10,
      faltou: 0,
    });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "proceed");
    assert.equal(decision.reason, "already_locked");
    assert.equal(decision.travado, 10);
  });

  // ─── T6: RPC says ccm_stock_disabled (flag toggled between calls) ────

  it("T6: RPC returns ccm_stock_disabled → disabled", () => {
    const lock = makeLockSummary({
      skipped: true,
      reason: "ccm_stock_disabled",
      travado: 0,
      faltou: 0,
    });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "disabled");
  });

  // ─── T7: Pix TTL safe (within lock TTL) ──────────────────────────────

  it("T7: Pix TTL within lock TTL → safe", () => {
    const v = validatePixTtl(600, 15);
    assert.equal(v.safe, true);
    assert.equal(v.effectivePixSeconds, 600);
    assert.equal(v.lockTtlSeconds, 900);
  });

  // ─── T8: Pix TTL exceeds lock TTL → capped ──────────────────────────

  it("T8: Pix TTL exceeds lock TTL → capped", () => {
    const v = validatePixTtl(3600, 15);
    assert.equal(v.safe, false);
    assert.equal(v.configInvalid, false);
    assert.equal(v.lockTtlSeconds, 900);
    assert.equal(v.effectivePixSeconds, 900 - PIX_TTL_SAFETY_MARGIN_SECONDS);
    assert.ok(v.effectivePixSeconds < 3600);
  });

  // ─── T9: Pix TTL exactly at boundary → safe ─────────────────────────

  it("T9: Pix TTL at boundary (lockTtl - margin) → safe", () => {
    const maxPix = 15 * 60 - PIX_TTL_SAFETY_MARGIN_SECONDS;
    const v = validatePixTtl(maxPix, 15);
    assert.equal(v.safe, true);
    assert.equal(v.effectivePixSeconds, maxPix);
  });

  // ─── T10: Lock TTL <= margin → configInvalid, no Pix allowed ────────

  it("T10: lock TTL <= margin → configInvalid", () => {
    const v = validatePixTtl(3600, 2); // 120s lock = 120s margin → 0 available
    assert.equal(v.configInvalid, true);
    assert.equal(v.effectivePixSeconds, 0);
    assert.equal(v.maxPixSeconds, 0);
  });

  it("T10b: lock TTL = 1 min → configInvalid", () => {
    const v = validatePixTtl(3600, 1); // 60s lock < 120s margin
    assert.equal(v.configInvalid, true);
    assert.equal(v.effectivePixSeconds, 0);
  });

  it("T10c: lock 5 min → Pix 3 min", () => {
    const v = validatePixTtl(3600, 5);
    assert.equal(v.configInvalid, false);
    assert.equal(v.effectivePixSeconds, 180); // 300 - 120 = 180s = 3 min
  });

  // ─── T11: Shortfall payload builds correctly ─────────────────────────

  it("T11: shortfall payload maps to correct suppliers", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 7, faltou: 3 },
      { masterProductId: "mp-2", solicitado: 5, travado: 5, faltou: 0 },
    ];
    const items = makeOrderItems();
    const oiMap = new Map([
      ["prod-1", "oi-1"],
      ["prod-2", "oi-2"],
    ]);

    const payload = buildShortfallSupplierPayload(details, items, oiMap);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].supplier_id, "sup-a");
    assert.equal(payload[0].items.length, 1);
    assert.equal(payload[0].items[0].quantity, 3);
    assert.equal(payload[0].items[0].product_name, "Cimento 50kg");
  });

  // ─── T12: Shortfall with multiple suppliers ──────────────────────────

  it("T12: multi-supplier shortfall", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 5, faltou: 5 },
      { masterProductId: "mp-2", solicitado: 5, travado: 2, faltou: 3 },
    ];
    const items = makeOrderItems();
    const oiMap = new Map([
      ["prod-1", "oi-1"],
      ["prod-2", "oi-2"],
    ]);

    const payload = buildShortfallSupplierPayload(details, items, oiMap);
    assert.equal(payload.length, 2);
    const supA = payload.find((p) => p.supplier_id === "sup-a");
    const supB = payload.find((p) => p.supplier_id === "sup-b");
    assert.ok(supA);
    assert.ok(supB);
    assert.equal(supA.items[0].quantity, 5);
    assert.equal(supB.items[0].quantity, 3);
  });

  // ─── T13: No shortfall → empty payload ───────────────────────────────

  it("T13: no shortfall → empty payload", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 10, faltou: 0 },
    ];
    const payload = buildShortfallSupplierPayload(
      details,
      makeOrderItems(),
      new Map([["prod-1", "oi-1"]]),
    );
    assert.equal(payload.length, 0);
  });

  // ─── T14: Gate bypass for 100% CCM ───────────────────────────────────

  it("T14: 100% CCM (locks + no supplier_requests) → bypass gate", () => {
    assert.equal(shouldBypassGate(true, false), true);
  });

  it("T14b: mixed (locks + supplier_requests) → no bypass", () => {
    assert.equal(shouldBypassGate(true, true), false);
  });

  it("T14c: no CCM locks → no bypass", () => {
    assert.equal(shouldBypassGate(false, false), false);
    assert.equal(shouldBypassGate(false, true), false);
  });

  // ─── T15: hasActiveCcmReservations ────────────────────────────────────

  it("T15: null lock result → no active reservations", () => {
    assert.equal(hasActiveCcmReservations(null), false);
  });

  it("T15b: disabled result → no active reservations", () => {
    const lock = makeLockSummary({
      skipped: true,
      reason: "ccm_stock_disabled",
      travado: 0,
    });
    assert.equal(hasActiveCcmReservations(lock), false);
  });

  it("T15c: travado > 0 → has active reservations", () => {
    const lock = makeLockSummary({ travado: 5 });
    assert.equal(hasActiveCcmReservations(lock), true);
  });

  // ─── T16: Partial lock with zero faltou still proceeds ───────────────

  it("T16: partial lock where all requested = all locked → proceed", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 10, faltou: 0 },
      { masterProductId: "mp-2", solicitado: 5, travado: 5, faltou: 0 },
    ];
    const lock = makeLockSummary({ travado: 15, faltou: 0, details });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "proceed");
    assert.equal(decision.travado, 15);
  });

  // ─── T17: Custom margin for Pix TTL ──────────────────────────────────

  it("T17: custom margin for Pix TTL validation", () => {
    const v = validatePixTtl(840, 15, 60);
    assert.equal(v.safe, true);
    assert.equal(v.configInvalid, false);
    assert.equal(v.maxPixSeconds, 840);
    assert.equal(v.effectivePixSeconds, 840);

    const v2 = validatePixTtl(841, 15, 60);
    assert.equal(v2.safe, false);
    assert.equal(v2.effectivePixSeconds, 840);
  });

  // ─── T17b: pix_expiration never >= lock_expiration ────────────────────

  it("T17b: effective Pix never >= lock TTL", () => {
    for (const lockMin of [3, 5, 10, 15, 30, 60]) {
      const v = validatePixTtl(99999, lockMin);
      if (v.configInvalid) continue;
      assert.ok(
        v.effectivePixSeconds < lockMin * 60,
        `effectivePix ${v.effectivePixSeconds}s >= lock ${lockMin * 60}s`,
      );
    }
  });

  // ─── T18: decidePaymentLockAction with null lockResult + ON → disabled

  it("T18: flag ON but null lockResult → disabled", () => {
    const decision = decidePaymentLockAction(null, ON);
    assert.equal(decision.action, "disabled");
  });

  // ─── T19: Shortfall with no matching oiMap entry → empty payload ─────

  it("T19: shortfall with unmapped products → empty payload", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-unknown", solicitado: 5, travado: 2, faltou: 3 },
    ];
    const payload = buildShortfallSupplierPayload(
      details,
      makeOrderItems(),
      new Map([["prod-1", "oi-1"]]),
    );
    assert.equal(payload.length, 0);
  });

  // ─── T20: decidePaymentLockAction shortfall details filtered ──────────

  it("T20: shortfallDetails only includes items with faltou > 0", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 10, travado: 10, faltou: 0 },
      { masterProductId: "mp-2", solicitado: 5, travado: 3, faltou: 2 },
      { masterProductId: "mp-3", solicitado: 8, travado: 8, faltou: 0 },
    ];
    const lock = makeLockSummary({ travado: 21, faltou: 2, details });
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "shortfall_needs_confirmation");
    assert.equal(decision.shortfallDetails.length, 1);
    assert.equal(decision.shortfallDetails[0].masterProductId, "mp-2");
  });

  // ─── T21: Shortfall sequence: reservation=3, lock=1, shortfall=2 ─────

  it("T21: shortfall sequence: lock persisted + supplier_request for exactly 2", () => {
    const details: LockResult[] = [
      { masterProductId: "mp-1", solicitado: 3, travado: 1, faltou: 2 },
    ];
    const lock = makeLockSummary({ travado: 1, faltou: 2, details });

    // Step 1: decision correctly identifies shortfall
    const decision = decidePaymentLockAction(lock, ON);
    assert.equal(decision.action, "shortfall_needs_confirmation");
    assert.equal(decision.travado, 1); // lock of 1 persisted
    assert.equal(decision.faltou, 2);

    // Step 2: supplier_request for exactly 2
    const items: OrderItem[] = [
      {
        product_id: "prod-1",
        supplier_id: "sup-a",
        master_product_id: "mp-1",
        name: "Cimento 50kg",
        qty: 3,
        unit: "un",
        supplier_cost_centavos: 2500,
        unit_price_centavos: 3500,
      },
    ];
    const oiMap = new Map([["prod-1", "oi-1"]]);
    const payload = buildShortfallSupplierPayload(details, items, oiMap);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].supplier_id, "sup-a");
    assert.equal(payload[0].items[0].quantity, 2); // exactly 2, not 3
  });

  // ─── T22: Retry after shortfall — idempotent via already_locked ──────

  it("T22: retry after shortfall — already_locked returns proceed", () => {
    // After shortfall: order reverted to aguardando-confirmacao
    // After supplier confirms: order advanced to aguardando-pagamento
    // Customer retries: RPC returns already_locked
    const lock = makeLockSummary({
      skipped: true,
      reason: "already_locked",
      travado: 1,
      faltou: 2, // still 2 reservations, but they're in supplier flow now
    });
    const decision = decidePaymentLockAction(lock, ON);

    // Should proceed — shortfall items are now covered by supplier_requests
    assert.equal(decision.action, "proceed");
    assert.equal(decision.reason, "already_locked");
    assert.equal(decision.travado, 1);
    // faltou is informational; doesn't block because already_locked
  });

  // ─── T23: Pix config smaller than lock → respects Pix config ────────

  it("T23: Pix config smaller than lock TTL → uses Pix config", () => {
    const v = validatePixTtl(300, 15); // 5 min Pix, 15 min lock
    assert.equal(v.safe, true);
    assert.equal(v.configInvalid, false);
    assert.equal(v.effectivePixSeconds, 300);
  });
});
