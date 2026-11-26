// CCM — Bloco 1 V2: regras do estoque CCM + reserva + trava de pagamento.
// Funções PURAS, sem acesso a banco. O backend encaixa nos RPCs e endpoints.

// ─── Types ────────────────────────────────────────────────────────────────

export type ReservationStatus = "reservation" | "payment_lock" | "sold" | "released";

export interface StockReservation {
  id: string;
  orderId: string;
  orderItemId: string;
  masterProductId: string;
  qty: number;
  status: ReservationStatus;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  soldAt: string | null;
  releasedAt: string | null;
}

export interface CcmInventoryRow {
  masterProductId: string;
  quantity: number;
}

export interface StockConfig {
  ccmStockEnabled: boolean;
  paymentLockTtlMinutes: number;
}

export interface ReserveItem {
  orderItemId: string;
  masterProductId: string;
  qty: number;
}

export interface LockResult {
  masterProductId: string;
  solicitado: number;
  travado: number;
  faltou: number;
}

export interface LockSummary {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  travado: number;
  faltou: number;
  expiresAt: string | null;
  details: LockResult[];
}

export interface ConfirmResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  soldCount: number;
  releasedCount: number;
}

export interface ReleaseResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  releasedCount: number;
}

export interface ExpireResult {
  ok: boolean;
  expiredCount: number;
}

export interface AvailabilityRow {
  masterProductId: string;
  fisico: number;
  pagos: number;
  travados: number;
  disponivel: number;
}

export interface OrderRoutingDecision {
  ccmItems: ReserveItem[];
  supplierItems: ReserveItem[];
}

// ─── Default config ───────────────────────────────────────────────────────

export const DEFAULT_CONFIG: StockConfig = {
  ccmStockEnabled: false,
  paymentLockTtlMinutes: 15,
};

// ─── 1. Availability ─────────────────────────────────────────────────────

export function computeAvailability(
  inventory: CcmInventoryRow[],
  reservations: StockReservation[],
  now: string,
): AvailabilityRow[] {
  return inventory.map(inv => {
    const productRes = reservations.filter(r => r.masterProductId === inv.masterProductId);
    const pagos = sumQty(productRes.filter(r => r.status === "sold"));
    const travados = sumQty(
      productRes.filter(r =>
        r.status === "payment_lock" &&
        r.lockExpiresAt !== null &&
        r.lockExpiresAt > now
      )
    );
    const disponivel = Math.max(inv.quantity - pagos - travados, 0);
    return {
      masterProductId: inv.masterProductId,
      fisico: inv.quantity,
      pagos,
      travados,
      disponivel,
    };
  });
}

// ─── 2. Reserve ──────────────────────────────────────────────────────────

export function reserveStock(
  orderId: string,
  items: ReserveItem[],
  existingReservations: StockReservation[],
  config: StockConfig,
  idGen: () => string,
): { ok: true; skipped?: boolean; reason?: string; created: StockReservation[] } {
  if (!config.ccmStockEnabled) {
    return { ok: true, skipped: true, reason: "ccm_stock_disabled", created: [] };
  }
  if (existingReservations.some(r => r.orderId === orderId)) {
    return { ok: true, skipped: true, reason: "already_reserved", created: [] };
  }
  const created: StockReservation[] = items.map(item => ({
    id: idGen(),
    orderId,
    orderItemId: item.orderItemId,
    masterProductId: item.masterProductId,
    qty: item.qty,
    status: "reservation" as const,
    lockedAt: null,
    lockExpiresAt: null,
    soldAt: null,
    releasedAt: null,
  }));
  return { ok: true, created };
}

// ─── 3. Lock for payment ─────────────────────────────────────────────────

export function lockForPayment(
  orderId: string,
  allReservations: StockReservation[],
  inventory: CcmInventoryRow[],
  config: StockConfig,
  now: string,
  idGen: () => string,
): { summary: LockSummary; updatedReservations: StockReservation[] } {
  if (!config.ccmStockEnabled) {
    return {
      summary: { ok: true, skipped: true, reason: "ccm_stock_disabled", travado: 0, faltou: 0, expiresAt: null, details: [] },
      updatedReservations: allReservations,
    };
  }

  const expiresAt = addMinutes(now, config.paymentLockTtlMinutes);

  // Idempotent: already locked
  const orderRes = allReservations.filter(r => r.orderId === orderId);
  if (orderRes.some(r => r.status === "payment_lock")) {
    const travado = sumQty(orderRes.filter(r => r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt > now));
    const faltou = sumQty(orderRes.filter(r => r.status === "reservation"));
    return {
      summary: { ok: true, skipped: true, reason: "already_locked", travado, faltou, expiresAt: null, details: [] },
      updatedReservations: allReservations,
    };
  }

  // Step 1: expire stale locks globally
  let updated = allReservations.map(r => {
    if (r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt <= now) {
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });

  // Step 2: process this order's reservations, sorted by masterProductId
  const orderReservations = updated
    .filter(r => r.orderId === orderId && r.status === "reservation")
    .sort((a, b) => a.masterProductId.localeCompare(b.masterProductId));

  const inventoryMap = new Map(inventory.map(i => [i.masterProductId, i.quantity]));
  let totalTravado = 0;
  let totalFaltou = 0;
  const details: LockResult[] = [];
  const newRows: StockReservation[] = [];

  for (const res of orderReservations) {
    const fisico = inventoryMap.get(res.masterProductId) ?? 0;

    // Current commitments (excluding this reservation)
    const otherRes = updated.filter(r =>
      r.masterProductId === res.masterProductId && r.id !== res.id
    );
    const pagos = sumQty(otherRes.filter(r => r.status === "sold"));
    const travados = sumQty(otherRes.filter(r =>
      r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt > now
    ));

    const disponivel = Math.max(fisico - pagos - travados, 0);
    const trava = Math.min(res.qty, disponivel);

    if (trava > 0) {
      if (trava < res.qty) {
        // Split: lock partial, keep remainder as reservation
        const remainderId = idGen();
        newRows.push({
          ...res,
          id: remainderId,
          qty: res.qty - trava,
          status: "reservation",
        });
        updated = updated.map(r =>
          r.id === res.id
            ? { ...r, qty: trava, status: "payment_lock" as const, lockedAt: now, lockExpiresAt: expiresAt }
            : r
        );
      } else {
        updated = updated.map(r =>
          r.id === res.id
            ? { ...r, status: "payment_lock" as const, lockedAt: now, lockExpiresAt: expiresAt }
            : r
        );
      }
      totalTravado += trava;
    }

    if (trava < res.qty) {
      totalFaltou += (res.qty - trava);
    }

    details.push({
      masterProductId: res.masterProductId,
      solicitado: res.qty,
      travado: trava,
      faltou: res.qty - trava,
    });
  }

  return {
    summary: { ok: true, travado: totalTravado, faltou: totalFaltou, expiresAt, details },
    updatedReservations: [...updated, ...newRows],
  };
}

// ─── 4. Confirm sale ─────────────────────────────────────────────────────

export function confirmSale(
  orderId: string,
  allReservations: StockReservation[],
  config: StockConfig,
  now: string,
): { result: ConfirmResult; updatedReservations: StockReservation[] } {
  if (!config.ccmStockEnabled) {
    return {
      result: { ok: true, skipped: true, reason: "ccm_stock_disabled", soldCount: 0, releasedCount: 0 },
      updatedReservations: allReservations,
    };
  }

  let soldCount = 0;
  let releasedCount = 0;

  const updated = allReservations.map(r => {
    if (r.orderId !== orderId) return r;

    if (r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt > now) {
      soldCount++;
      return { ...r, status: "sold" as const, soldAt: now };
    }
    if (r.status === "reservation" || r.status === "payment_lock") {
      releasedCount++;
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });

  return {
    result: { ok: true, soldCount, releasedCount },
    updatedReservations: updated,
  };
}

// ─── 5. Release (cancel) ─────────────────────────────────────────────────

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
  const updated = allReservations.map(r => {
    if (r.orderId !== orderId) return r;
    if (r.status === "reservation" || r.status === "payment_lock") {
      releasedCount++;
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });

  return {
    result: { ok: true, releasedCount },
    updatedReservations: updated,
  };
}

// ─── 6. Expire locks ─────────────────────────────────────────────────────

export function expirePaymentLocks(
  allReservations: StockReservation[],
  now: string,
): { result: ExpireResult; updatedReservations: StockReservation[] } {
  let expiredCount = 0;
  const updated = allReservations.map(r => {
    if (r.status === "payment_lock" && r.lockExpiresAt !== null && r.lockExpiresAt <= now) {
      expiredCount++;
      return { ...r, status: "released" as const, releasedAt: now };
    }
    return r;
  });
  return { result: { ok: true, expiredCount }, updatedReservations: updated };
}

// ─── 7. Order routing decision ───────────────────────────────────────────

export function routeOrderItems(
  items: ReserveItem[],
  inventory: CcmInventoryRow[],
  reservations: StockReservation[],
  config: StockConfig,
  now: string,
): OrderRoutingDecision {
  if (!config.ccmStockEnabled) {
    return { ccmItems: [], supplierItems: items };
  }

  const avail = computeAvailability(inventory, reservations, now);
  const availMap = new Map(avail.map(a => [a.masterProductId, a.disponivel]));

  const ccmItems: ReserveItem[] = [];
  const supplierItems: ReserveItem[] = [];

  for (const item of items) {
    const disponivel = availMap.get(item.masterProductId) ?? 0;
    if (disponivel <= 0) {
      supplierItems.push(item);
    } else if (disponivel >= item.qty) {
      ccmItems.push(item);
    } else {
      ccmItems.push({ ...item, qty: disponivel });
      supplierItems.push({ ...item, qty: item.qty - disponivel });
    }
  }

  return { ccmItems, supplierItems };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function sumQty(rows: StockReservation[]): number {
  return rows.reduce((acc, r) => acc + r.qty, 0);
}

function addMinutes(isoDate: string, minutes: number): string {
  const d = new Date(isoDate);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}
