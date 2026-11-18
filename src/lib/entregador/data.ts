import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ShipmentStatus } from "@/lib/orders";

const configured = () => isSupabaseConfigured();

export interface EntregadorShipmentCard {
  id: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  sequence: number;
  status: ShipmentStatus;
  delivery_method: string;
  promised_from: string | null;
  promised_to: string | null;
  address_district: string | null;
  item_count: number;
  updated_at: string;
}

export interface EntregadorItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
}

export interface EntregadorShipmentDetail {
  id: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  customer_phone: string | null;
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
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_cep: string | null;
  address_reference: string | null;
  notes: string | null;
  items: EntregadorItem[];
}

export interface EntregadorOccurrence {
  id: string;
  type: string;
  description: string;
  occurred_at: string;
}

export async function readActiveShipments(): Promise<EntregadorShipmentCard[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("entregador_active_shipments");
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
    address_district: r.address_district as string | null,
    item_count: Number(r.item_count ?? 0),
    updated_at: r.updated_at as string,
  }));
}

export async function readRecentShipments(limit = 10): Promise<EntregadorShipmentCard[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("entregador_recent_shipments", { p_limit: limit });
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
    address_district: r.address_district as string | null,
    item_count: Number(r.item_count ?? 0),
    updated_at: r.updated_at as string,
  }));
}

export async function readShipmentDetail(shipmentId: string): Promise<EntregadorShipmentDetail | null> {
  if (!configured()) return null;
  const sb = await createClient();

  const { data, error } = await sb.rpc("entregador_shipment_detail", { p_shipment_id: shipmentId });
  if (error || !data) return null;

  const d = data as Record<string, unknown>;
  if (d.error) return null;

  const items = (d.items as Record<string, unknown>[] | null) ?? [];

  return {
    id: d.id as string,
    order_id: d.order_id as string,
    order_code: d.order_code as string,
    customer_name: d.customer_name as string,
    customer_phone: d.customer_phone as string | null,
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
    address_street: d.address_street as string | null,
    address_number: d.address_number as string | null,
    address_complement: d.address_complement as string | null,
    address_district: d.address_district as string | null,
    address_city: d.address_city as string | null,
    address_state: d.address_state as string | null,
    address_cep: d.address_cep as string | null,
    address_reference: d.address_reference as string | null,
    notes: d.notes as string | null,
    items: items.map((i) => ({
      id: i.id as string,
      name: i.name as string,
      qty: i.qty as number,
      unit: i.unit as string,
    })),
  };
}

export async function readShipmentOccurrences(shipmentId: string): Promise<EntregadorOccurrence[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data, error } = await sb.rpc("entregador_shipment_occurrences", { p_shipment_id: shipmentId });
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    description: r.description as string,
    occurred_at: r.occurred_at as string,
  }));
}
