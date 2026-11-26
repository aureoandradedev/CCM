// CCM — Bloco 1 V2, Etapa 4: Trava atômica de estoque CCM no pagamento.
// Pure functions for the payment-time CCM stock lock decisions.
// Backend (ccm-payment-lock.mjs) mirrors this logic with DB calls.

import {
  type StockConfig,
  type LockResult,
  type LockSummary,
  DEFAULT_CONFIG,
} from "./regras2.ts";

import {
  type OrderItem,
  type SupplierRequestItem,
  type SupplierPayload,
} from "./regras3.ts";

// ─── Types ────────────────────────────────────────────────────────────────

export type PaymentLockAction =
  | "proceed"
  | "shortfall_needs_confirmation"
  | "disabled"
  | "error";

export interface PaymentLockDecision {
  action: PaymentLockAction;
  reason: string;
  travado: number;
  faltou: number;
  expiresAt: string | null;
  shortfallDetails: LockResult[];
}

export interface PixTtlValidation {
  safe: boolean;
  configInvalid: boolean;
  maxPixSeconds: number;
  effectivePixSeconds: number;
  lockTtlSeconds: number;
  reason: string;
}

export interface ShortfallItem {
  orderItemId: string;
  masterProductId: string;
  faltou: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PIX_TTL_SAFETY_MARGIN_SECONDS = 120;
const MIN_SAFE_PIX_SECONDS = 60;

// ─── 1. Decide payment action from lock RPC result ───────────────────────

export function decidePaymentLockAction(
  lockResult: LockSummary | null,
  config: StockConfig,
): PaymentLockDecision {
  if (!config.ccmStockEnabled || !lockResult) {
    return {
      action: "disabled",
      reason: "ccm_stock_disabled",
      travado: 0,
      faltou: 0,
      expiresAt: null,
      shortfallDetails: [],
    };
  }

  if (lockResult.skipped && lockResult.reason === "ccm_stock_disabled") {
    return {
      action: "disabled",
      reason: "ccm_stock_disabled",
      travado: 0,
      faltou: 0,
      expiresAt: null,
      shortfallDetails: [],
    };
  }

  if (lockResult.skipped && lockResult.reason === "already_locked") {
    return {
      action: "proceed",
      reason: "already_locked",
      travado: lockResult.travado,
      faltou: lockResult.faltou,
      expiresAt: lockResult.expiresAt,
      shortfallDetails: [],
    };
  }

  if (!lockResult.ok) {
    return {
      action: "error",
      reason: "lock_failed",
      travado: 0,
      faltou: 0,
      expiresAt: null,
      shortfallDetails: [],
    };
  }

  const shortfall = (lockResult.details || []).filter((d) => d.faltou > 0);

  if (lockResult.faltou > 0) {
    return {
      action: "shortfall_needs_confirmation",
      reason: "ccm_stock_insufficient",
      travado: lockResult.travado,
      faltou: lockResult.faltou,
      expiresAt: lockResult.expiresAt,
      shortfallDetails: shortfall,
    };
  }

  return {
    action: "proceed",
    reason: "all_locked",
    travado: lockResult.travado,
    faltou: 0,
    expiresAt: lockResult.expiresAt,
    shortfallDetails: [],
  };
}

// ─── 2. Validate Pix TTL against CCM lock TTL ───────────────────────────

export function validatePixTtl(
  pixExpiracaoSegundos: number,
  lockTtlMinutes: number,
  marginSeconds: number = PIX_TTL_SAFETY_MARGIN_SECONDS,
): PixTtlValidation {
  const lockTtlSeconds = lockTtlMinutes * 60;
  const available = lockTtlSeconds - marginSeconds;

  if (available < MIN_SAFE_PIX_SECONDS) {
    return {
      safe: false,
      configInvalid: true,
      maxPixSeconds: 0,
      effectivePixSeconds: 0,
      lockTtlSeconds,
      reason: `config_invalid:lock_ttl_${lockTtlSeconds}s_minus_margin_${marginSeconds}s_is_${available}s_below_min_${MIN_SAFE_PIX_SECONDS}s`,
    };
  }

  const maxPixSeconds = available;
  const effectivePixSeconds = Math.min(pixExpiracaoSegundos, maxPixSeconds);
  const safe = pixExpiracaoSegundos <= maxPixSeconds;

  return {
    safe,
    configInvalid: false,
    maxPixSeconds,
    effectivePixSeconds,
    lockTtlSeconds,
    reason: safe
      ? "pix_within_lock_ttl"
      : `pix_capped_from_${pixExpiracaoSegundos}s_to_${effectivePixSeconds}s`,
  };
}

// ─── 3. Build supplier_request payload for shortfall items ──────────────

export function buildShortfallSupplierPayload(
  shortfallDetails: LockResult[],
  orderItems: OrderItem[],
  oiMap: Map<string, string>,
): SupplierPayload[] {
  const bySupplier = new Map<string, SupplierRequestItem[]>();

  for (const detail of shortfallDetails) {
    if (detail.faltou <= 0) continue;

    const matchingItems = orderItems.filter(
      (oi) => oi.master_product_id === detail.masterProductId,
    );

    for (const item of matchingItems) {
      const oiId = oiMap.get(item.product_id);
      if (!oiId) continue;

      const existing = bySupplier.get(item.supplier_id) ?? [];
      existing.push({
        order_item_id: oiId,
        master_product_id: item.master_product_id,
        product_name: item.name,
        quantity: detail.faltou,
        unit: item.unit ?? "un",
        unit_cost_centavos:
          item.supplier_cost_centavos ?? item.unit_price_centavos,
      });
      bySupplier.set(item.supplier_id, existing);
    }
  }

  return Array.from(bySupplier.entries())
    .map(([supplier_id, items]) => ({ supplier_id, items }))
    .filter((s) => s.items.length > 0);
}

// ─── 4. Check if order needs gate bypass (100% CCM) ─────────────────────

export function shouldBypassGate(
  hasCcmLocks: boolean,
  hasSupplierRequests: boolean,
): boolean {
  return hasCcmLocks && !hasSupplierRequests;
}

// ─── 5. No-reservation check (flag OFF or no CCM items) ─────────────────

export function hasActiveCcmReservations(lockResult: LockSummary | null): boolean {
  if (!lockResult) return false;
  if (lockResult.skipped && lockResult.reason === "ccm_stock_disabled") return false;
  return lockResult.travado > 0;
}

// ─── Re-exports ─────────────────────────────────────────────────────────

export { DEFAULT_CONFIG } from "./regras2.ts";
export { PIX_TTL_SAFETY_MARGIN_SECONDS, MIN_SAFE_PIX_SECONDS };
