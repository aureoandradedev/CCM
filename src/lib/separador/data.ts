import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ShipmentStatus } from "@/lib/orders";

const configured = () => isSupabaseConfigured();

/** Minimal shipment data for the list — no financial/fiscal/personal data. */
export interface SeparadorShipmentCard {
  id: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  sequence: number;
  status: ShipmentStatus;
  delivery_method: string;
  promised_from: string | null;
  promised_to: string | null;
  item_count: number;
  updated_at: string;
}

/** Minimal item data — no price, no supplier, no financial columns. */
export interface SeparadorItem {
  id: string;
  name: string;
  sku: string | null;
  image: string | null;
  unit: string;
  qty: number;
  picked_qty: number | null;
  picked_at: string | null;
}

/** Detail view — shipment + items + delivery info. */
export interface SeparadorShipmentDetail {
  id: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  sequence: number;
  status: ShipmentStatus;
  delivery_method: string;
  promised_from: string | null;
  promised_to: string | null;
  tracking_code: string | null;
  carrier: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  updated_at: string;
  address_district: string | null;
  address_reference: string | null;
  notes: string | null;
  items: SeparadorItem[];
}

export interface SeparadorOccurrence {
  id: string;
  type: string;
  description: string;
  occurred_at: string;
}

/**
 * Active shipments via SECURITY DEFINER RPC — no direct table access.
 * RPC returns only safe columns (order code, customer first name, delivery info).
 */
export async function readActiveShipments(): Promise<SeparadorShipmentCard[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("separador_active_shipments");
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    order_id: r.order_id as string,
    order_code: r.order_code as string,
    customer_name: r.customer_first_name as string,
    sequence: r.sequence as number,
    status: r.status as ShipmentStatus,
    delivery_method: r.delivery_method as string,
    promised_from: r.promised_from as string | null,
    promised_to: r.promised_to as string | null,
    item_count: Number(r.item_count ?? 0),
    updated_at: r.updated_at as string,
  }));
}

/**
 * Recent completed shipments via SECURITY DEFINER RPC.
 */
export async function readRecentShipments(limit = 10): Promise<SeparadorShipmentCard[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("separador_recent_shipments", { p_limit: limit });
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    order_id: r.order_id as string,
    order_code: r.order_code as string,
    customer_name: r.customer_first_name as string,
    sequence: r.sequence as number,
    status: r.status as ShipmentStatus,
    delivery_method: r.delivery_method as string,
    promised_from: r.promised_from as string | null,
    promised_to: r.promised_to as string | null,
    item_count: Number(r.item_count ?? 0),
    updated_at: r.updated_at as string,
  }));
}

/**
 * Shipment detail via SECURITY DEFINER RPC — data-minimized.
 * RPC returns jsonb with only safe columns + items with picked_qty/picked_at.
 */
export async function readShipmentDetail(shipmentId: string): Promise<SeparadorShipmentDetail | null> {
  if (!configured()) return null;
  const sb = await createClient();

  const { data, error } = await sb.rpc("separador_shipment_detail", { p_shipment_id: shipmentId });
  if (error || !data) return null;

  const d = data as Record<string, unknown>;
  if (d.error) return null;

  const items = (d.items as Record<string, unknown>[] | null) ?? [];

  return {
    id: d.id as string,
    order_id: d.order_id as string,
    order_code: d.order_code as string,
    customer_name: d.customer_name as string,
    sequence: d.sequence as number,
    status: d.status as ShipmentStatus,
    delivery_method: d.delivery_method as string,
    promised_from: d.promised_from as string | null,
    promised_to: d.promised_to as string | null,
    tracking_code: d.tracking_code as string | null,
    carrier: d.carrier as string | null,
    shipped_at: d.shipped_at as string | null,
    delivered_at: d.delivered_at as string | null,
    updated_at: d.updated_at as string,
    address_district: d.address_district as string | null,
    address_reference: d.address_reference as string | null,
    notes: d.notes as string | null,
    items: items.map((i) => ({
      id: i.id as string,
      name: i.name as string,
      sku: (i.sku as string | null) ?? null,
      image: (i.image as string | null) ?? null,
      unit: i.unit as string,
      qty: i.qty as number,
      picked_qty: (i.picked_qty as number | null) ?? null,
      picked_at: (i.picked_at as string | null) ?? null,
    })),
  };
}

/**
 * Shipment occurrences via SECURITY DEFINER RPC.
 */
export async function readShipmentOccurrences(shipmentId: string): Promise<SeparadorOccurrence[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("separador_shipment_occurrences", { p_shipment_id: shipmentId });
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    description: r.description as string,
    occurred_at: r.occurred_at as string,
  }));
}
