import { ORDER_COLUMNS, type OrderItemRow, type OrderRow, type OrderShipmentRow } from "@/lib/orders";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** Pedidos do usuário logado (RLS: só os dele; admin vê todos). */
export async function getMyOrders(limit = 50): Promise<OrderRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from("orders").select(ORDER_COLUMNS).eq("profile_id", user.id).order("created_at", { ascending: false }).limit(limit);
  return (data as OrderRow[] | null) ?? [];
}

export async function getOrderByCode(code: string): Promise<{ order: OrderRow; items: OrderItemRow[]; shipments: OrderShipmentRow[] } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select(ORDER_COLUMNS).eq("code", code.toUpperCase()).maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: shipments }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", order.id).order("name"),
    supabase.from("order_shipments").select("*").eq("order_id", order.id).order("sequence"),
  ]);
  return { order: order as OrderRow, items: (items as OrderItemRow[] | null) ?? [], shipments: (shipments as OrderShipmentRow[] | null) ?? [] };
}
