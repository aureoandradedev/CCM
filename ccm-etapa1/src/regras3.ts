// CCM — Bloco 1 V2, Etapa 3: Integração reserva × checkout.
// Pure functions for the post-order-creation routing + reservation payload.
// Backend (ccm-stock.mjs) mirrors this logic with DB calls.

import {
  type StockConfig,
  type ReserveItem,
  DEFAULT_CONFIG,
} from "./regras2.ts";

// ─── Types ────────────────────────────────────────────────────────────────

export interface OrderItem {
  product_id: string;
  supplier_id: string;
  master_product_id: string | null;
  name: string;
  qty: number;
  unit: string;
  supplier_cost_centavos: number | null;
  unit_price_centavos: number;
}

export interface CcmReservationPayload {
  order_item_id: string;
  master_product_id: string;
  qty: number;
}

export interface SupplierRequestItem {
  order_item_id: string | null;
  master_product_id: string | null;
  product_name: string;
  quantity: number;
  unit: string;
  unit_cost_centavos: number;
}

export interface SupplierPayload {
  supplier_id: string;
  items: SupplierRequestItem[];
}

export interface CheckoutRouting {
  disabled: boolean;
  ccmReservations: CcmReservationPayload[];
  supplierQtyByProduct: Map<string, number>;
}

// ─── 1. Route items between CCM stock and supplier ───────────────────────

export function routeOrderForCheckout(
  itens: OrderItem[],
  oiMap: Map<string, string>,
  availability: Map<string, number>,
  config: StockConfig,
): CheckoutRouting {
  if (!config.ccmStockEnabled) {
    return {
      disabled: true,
      ccmReservations: [],
      supplierQtyByProduct: new Map(itens.map((i) => [i.product_id, i.qty])),
    };
  }

  const remaining = new Map(availability);
  const ccmReservations: CcmReservationPayload[] = [];
  const supplierQtyByProduct = new Map<string, number>();

  for (const item of itens) {
    const oiId = oiMap.get(item.product_id);
    if (!oiId || !item.master_product_id) {
      supplierQtyByProduct.set(item.product_id, item.qty);
      continue;
    }

    const disponivel = remaining.get(item.master_product_id) ?? 0;

    if (disponivel <= 0) {
      supplierQtyByProduct.set(item.product_id, item.qty);
    } else if (disponivel >= item.qty) {
      ccmReservations.push({
        order_item_id: oiId,
        master_product_id: item.master_product_id,
        qty: item.qty,
      });
      supplierQtyByProduct.set(item.product_id, 0);
      remaining.set(item.master_product_id, disponivel - item.qty);
    } else {
      ccmReservations.push({
        order_item_id: oiId,
        master_product_id: item.master_product_id,
        qty: disponivel,
      });
      supplierQtyByProduct.set(item.product_id, item.qty - disponivel);
      remaining.set(item.master_product_id, 0);
    }
  }

  return { disabled: false, ccmReservations, supplierQtyByProduct };
}

// ─── 2. Build supplier_requests payload (adjusted for CCM) ──────────────

export function buildSupplierPayload(
  supplierIds: string[],
  itens: OrderItem[],
  oiMap: Map<string, string>,
  routing: CheckoutRouting | null,
): SupplierPayload[] {
  return supplierIds
    .map((sid) => {
      const supplierItems = itens.filter((i) => i.supplier_id === sid);
      const items: SupplierRequestItem[] = [];

      for (const i of supplierItems) {
        let qty = i.qty;
        if (routing && !routing.disabled) {
          qty = routing.supplierQtyByProduct.get(i.product_id) ?? i.qty;
          if (qty <= 0) continue;
        }
        items.push({
          order_item_id: oiMap.get(i.product_id) ?? null,
          master_product_id: i.master_product_id,
          product_name: i.name,
          quantity: qty,
          unit: i.unit ?? "un",
          unit_cost_centavos: i.supplier_cost_centavos ?? i.unit_price_centavos,
        });
      }

      return { supplier_id: sid, items };
    })
    .filter((s) => s.items.length > 0);
}

// ─── 3. Convenience: full checkout routing result ────────────────────────

export interface CheckoutStockResult {
  routing: CheckoutRouting;
  supplierPayload: SupplierPayload[];
  hasCcmItems: boolean;
  hasSupplierItems: boolean;
  allCcm: boolean;
}

export function computeCheckoutStock(
  itens: OrderItem[],
  supplierIds: string[],
  oiMap: Map<string, string>,
  availability: Map<string, number>,
  config: StockConfig,
): CheckoutStockResult {
  const routing = routeOrderForCheckout(itens, oiMap, availability, config);
  const supplierPayload = buildSupplierPayload(supplierIds, itens, oiMap, routing);
  const hasCcmItems = routing.ccmReservations.length > 0;
  const hasSupplierItems = supplierPayload.length > 0;
  const allCcm = hasCcmItems && !hasSupplierItems;

  return { routing, supplierPayload, hasCcmItems, hasSupplierItems, allCcm };
}

export { DEFAULT_CONFIG } from "./regras2.ts";
