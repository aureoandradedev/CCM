// CCM — Bloco 1 V2, Etapa 5: Confirmação da venda + liberação/cancelamento + expiração.
// Pure functions for confirm/release/expire decisions and inventory movements.
// Backend (ccm-payment-lock.mjs) mirrors this logic with DB calls.

import {
  type StockConfig,
  type StockReservation,
  type ConfirmResult,
  type ReleaseResult,
  type ExpireResult,
  type AvailabilityRow,
  type CcmInventoryRow,
  DEFAULT_CONFIG,
} from "./regras2.ts";

// ─── Types ────────────────────────────────────────────────────────────────

export type SaleConfirmAction = "confirm" | "skipped" | "already_confirmed" | "no_locks";

export interface SaleConfirmDecision {
  action: SaleConfirmAction;
  reason: string;
  soldCount: number;
  releasedCount: number;
}

export type ReleaseAction = "released" | "skipped" | "nothing_to_release";

export interface ReleaseDecision {
  action: ReleaseAction;
  reason: string;
  releasedCount: number;
  soldPreserved: number;
}

export type InventoryMovementType =
  | "sale_from_stock"
  | "receipt"
  | "adjustment"
  | "return";

export interface InventoryMovement {
  reservationId: string;
  masterProductId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitCostCentavos: number | null;
  sourceOrderId: string;
  reason: string;
}

export interface MixedOrderClassification {
  ccmSoldItems: StockReservation[];
  supplierItems: { orderItemId: string; masterProductId: string | null; qty: number }[];
  totalItems: number;
  ccmCount: number;
  supplierCount: number;
}

// ─── 1. Decide sale confirmation from RPC result ────────────────────────

export function decideSaleConfirmation(
  confirmResult: ConfirmResult | null,
  config: StockConfig,
): SaleConfirmDecision {
  if (!config.ccmStockEnabled || !confirmResult) {
    return {
      action: "skipped",
      reason: "ccm_stock_disabled",
      soldCount: 0,
      releasedCount: 0,
    };
  }

  if (confirmResult.skipped && confirmResult.reason === "ccm_stock_disabled") {
    return {
      action: "skipped",
      reason: "ccm_stock_disabled",
      soldCount: 0,
      releasedCount: 0,
    };
  }

  if (confirmResult.soldCount === 0 && confirmResult.releasedCount === 0) {
    return {
      action: "no_locks",
      reason: "no_active_locks_found",
      soldCount: 0,
      releasedCount: 0,
    };
  }

  return {
    action: "confirm",
    reason: "locks_promoted_to_sold",
    soldCount: confirmResult.soldCount,
    releasedCount: confirmResult.releasedCount,
  };
}

// ─── 2. Decide stock release from RPC result ────────────────────────────

export function decideStockRelease(
  releaseResult: ReleaseResult | null,
  config: StockConfig,
): ReleaseDecision {
  if (!config.ccmStockEnabled || !releaseResult) {
    return {
      action: "skipped",
      reason: "ccm_stock_disabled",
      releasedCount: 0,
      soldPreserved: 0,
    };
  }

  if (releaseResult.skipped && releaseResult.reason === "ccm_stock_disabled") {
    return {
      action: "skipped",
      reason: "ccm_stock_disabled",
      releasedCount: 0,
      soldPreserved: 0,
    };
  }

  if (releaseResult.releasedCount === 0) {
    return {
      action: "nothing_to_release",
      reason: "no_releasable_reservations",
      releasedCount: 0,
      soldPreserved: 0,
    };
  }

  return {
    action: "released",
    reason: "reservations_released",
    releasedCount: releaseResult.releasedCount,
    soldPreserved: 0,
  };
}

// ─── 3. Build inventory movements for CCM-sold items ────────────────────
// 0065: per-reservation granularity — one movement per sold reservation,
// NOT aggregated by master_product_id. Preserves audit trail per order_item.

export function buildSaleMovements(
  soldReservations: StockReservation[],
  unitCostMap: Map<string, number>,
  orderId: string,
): InventoryMovement[] {
  return soldReservations.map((r) => ({
    reservationId: r.id,
    masterProductId: r.masterProductId,
    movementType: "sale_from_stock" as const,
    quantity: -r.qty,
    unitCostCentavos: unitCostMap.get(r.masterProductId) ?? null,
    sourceOrderId: orderId,
    reason: "ccm_direct_sale",
  }));
}

// ─── 4. Classify mixed order items ──────────────────────────────────────

export function classifyMixedOrder(
  reservations: StockReservation[],
  orderItems: { orderItemId: string; masterProductId: string | null; qty: number; supplierId: string | null }[],
): MixedOrderClassification {
  const ccmSoldItems = reservations.filter((r) => r.status === "sold");

  const ccmOrderItemIds = new Set(ccmSoldItems.map((r) => r.orderItemId));
  const supplierItems = orderItems
    .filter((oi) => !ccmOrderItemIds.has(oi.orderItemId))
    .map((oi) => ({
      orderItemId: oi.orderItemId,
      masterProductId: oi.masterProductId,
      qty: oi.qty,
    }));

  return {
    ccmSoldItems,
    supplierItems,
    totalItems: orderItems.length,
    ccmCount: ccmSoldItems.length,
    supplierCount: supplierItems.length,
  };
}

// ─── 5. Simulate confirm_ccm_stock_sale (pure, for testing) ─────────────
// 0065: accepts optional paidAt for rescue simulation.
// When paidAt is provided, also rescues 'released' rows where paidAt <= lockExpiresAt.
// When paidAt is null, uses a 5-minute grace window (lockExpiresAt > now - 5min).

export function confirmSale(
  orderId: string,
  allReservations: StockReservation[],
  config: StockConfig,
  now: string,
  paidAt?: string | null,
  inventory?: CcmInventoryRow[],
): { result: ConfirmResult & { rescuedCount?: number; rescueFailed?: number }; updatedReservations: StockReservation[] } {
  if (!config.ccmStockEnabled) {
    return {
      result: { ok: true, skipped: true, reason: "ccm_stock_disabled", soldCount: 0, releasedCount: 0 },
      updatedReservations: allReservations,
    };
  }

  let soldCount = 0;
  let releasedCount = 0;
  let rescuedCount = 0;
  let rescueFailed = 0;

  const graceMs = 5 * 60 * 1000;
  const nowMs = new Date(now).getTime();
  const effectivePaidAt = paidAt ?? now;

  // Step 1: Promote active locks
  let updated = allReservations.map((r) => {
    if (r.orderId !== orderId) return r;

    if (r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt > now) {
      soldCount += r.qty;
      return { ...r, status: "sold" as const, soldAt: now };
    }

    return r;
  });

  // Step 2: Rescue expired locks (cron ran before webhook)
  updated = updated.map((r) => {
    if (r.orderId !== orderId || r.status !== "released" || r.lockExpiresAt === null) return r;

    const canRescue = paidAt !== undefined
      ? (effectivePaidAt <= r.lockExpiresAt)
      : (new Date(r.lockExpiresAt).getTime() > nowMs - graceMs);

    if (!canRescue) return r;

    // Check inventory availability (simplified: assumes inventory param provided)
    if (inventory) {
      const inv = inventory.find((i) => i.masterProductId === r.masterProductId);
      const committed = updated
        .filter((x) => x.masterProductId === r.masterProductId && x.id !== r.id
          && (x.status === "sold" || (x.status === "payment_lock" && x.lockExpiresAt !== null && x.lockExpiresAt > now)))
        .reduce((s, x) => s + x.qty, 0);
      const available = (inv?.quantity ?? 0) - committed;
      if (available < r.qty) {
        rescueFailed++;
        return r;
      }
    }

    rescuedCount++;
    return { ...r, status: "sold" as const, soldAt: now };
  });

  // Step 3: Release remaining
  updated = updated.map((r) => {
    if (r.orderId !== orderId) return r;
    if (r.status === "reservation" || r.status === "payment_lock") {
      releasedCount += r.qty;
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });

  return {
    result: { ok: true, soldCount: soldCount + rescuedCount, releasedCount, rescuedCount, rescueFailed },
    updatedReservations: updated,
  };
}

// ─── 6. Simulate release_ccm_stock (pure, for testing) ──────────────────

export function releaseStock(
  orderId: string,
  allReservations: StockReservation[],
  config: StockConfig,
  now: string,
): { result: ReleaseResult; updatedReservations: StockReservation[] } {
  if (!config.ccmStockEnabled) {
    return {
      result: { ok: true, skipped: true, reason: "ccm_stock_disabled", releasedCount: 0 },
      updatedReservations: allReservations,
    };
  }

  let releasedCount = 0;

  const updated = allReservations.map((r) => {
    if (r.orderId !== orderId) return r;

    // Release reservation and payment_lock — never sold
    if (r.status === "reservation" || r.status === "payment_lock") {
      releasedCount += r.qty;
      return { ...r, status: "released" as const, releasedAt: now };
    }

    return r;
  });

  return {
    result: { ok: true, releasedCount },
    updatedReservations: updated,
  };
}

// ─── 7. Simulate expire_payment_locks (pure, for testing) ───────────────

export function expireLocks(
  allReservations: StockReservation[],
  now: string,
): { result: ExpireResult; updatedReservations: StockReservation[] } {
  let expiredCount = 0;

  const updated = allReservations.map((r) => {
    if (r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt <= now) {
      expiredCount += r.qty;
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });

  return {
    result: { ok: true, expiredCount },
    updatedReservations: updated,
  };
}

// ─── 8. Race: can confirm sale? (lock must still be active) ─────────────

export function canConfirmSale(
  reservation: StockReservation,
  now: string,
): boolean {
  return (
    reservation.status === "payment_lock" &&
    reservation.lockExpiresAt !== null &&
    reservation.lockExpiresAt > now
  );
}

// ─── 8b. Can rescue an expired lock? ───────────────────────────────────
// Returns true if the reservation was a payment_lock that cron expired,
// but the payment happened before (or within grace of) the lock expiry.

export function canRescueExpiredSale(
  reservation: StockReservation,
  now: string,
  paidAt?: string | null,
): boolean {
  if (reservation.status !== "released" || reservation.lockExpiresAt === null) return false;
  if (paidAt !== undefined && paidAt !== null) {
    return paidAt <= reservation.lockExpiresAt;
  }
  const graceMs = 5 * 60 * 1000;
  return new Date(reservation.lockExpiresAt).getTime() > new Date(now).getTime() - graceMs;
}

// ─── 9. Availability after confirm ──────────────────────────────────────

export function availabilityAfterConfirm(
  inventory: CcmInventoryRow[],
  reservations: StockReservation[],
  now: string,
): AvailabilityRow[] {
  return inventory.map((inv) => {
    const productRes = reservations.filter(
      (r) => r.masterProductId === inv.masterProductId,
    );
    const pagos = productRes
      .filter((r) => r.status === "sold")
      .reduce((s, r) => s + r.qty, 0);
    const travados = productRes
      .filter(
        (r) =>
          r.status === "payment_lock" &&
          r.lockExpiresAt !== null &&
          r.lockExpiresAt > now,
      )
      .reduce((s, r) => s + r.qty, 0);
    return {
      masterProductId: inv.masterProductId,
      fisico: inv.quantity,
      pagos,
      travados,
      disponivel: Math.max(inv.quantity - pagos - travados, 0),
    };
  });
}

// ─── Re-exports ─────────────────────────────────────────────────────────

export { DEFAULT_CONFIG } from "./regras2.ts";
