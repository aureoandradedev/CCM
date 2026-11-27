import { CUSTOMER_ITEM_COLUMNS, CUSTOMER_ORDER_COLUMNS, type CcmOrderDisplay, type OrderItemRow, type OrderRow, type OrderShipmentRow } from "@/lib/orders";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface PendingPaymentOrder {
  code: string;
  total_centavos: number;
  payment_method: string | null;
  created_at: string;
}

/** Pedidos do usuário com pagamento pendente (aguardando-pagamento + pendente). */
export async function getPendingPaymentOrders(): Promise<PendingPaymentOrder[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("orders")
    .select("code, total_centavos, payment_method, created_at")
    .eq("profile_id", user.id)
    .eq("order_status", "aguardando-pagamento")
    .eq("payment_status", "pendente")
    .order("created_at", { ascending: true });
  return (data as PendingPaymentOrder[] | null) ?? [];
}

/** Pedidos do usuário logado (RLS: só os dele; admin vê todos). */
export async function getMyOrders(limit = 50): Promise<OrderRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.from("orders").select(CUSTOMER_ORDER_COLUMNS).eq("profile_id", user.id).order("created_at", { ascending: false }).limit(limit);
  return (data as OrderRow[] | null) ?? [];
}

export async function getOrderByCode(code: string): Promise<{ order: OrderRow; items: OrderItemRow[]; shipments: OrderShipmentRow[] } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select(CUSTOMER_ORDER_COLUMNS).eq("code", code.toUpperCase()).maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: shipments }] = await Promise.all([
    supabase.from("order_items").select(CUSTOMER_ITEM_COLUMNS).eq("order_id", order.id).order("name"),
    supabase.from("order_shipments").select("*").eq("order_id", order.id).order("sequence"),
  ]);
  return { order: order as OrderRow, items: (items as OrderItemRow[] | null) ?? [], shipments: (shipments as OrderShipmentRow[] | null) ?? [] };
}

const CCM_OFF: CcmOrderDisplay = { enabled: false, hasCcm: false, isCcmOnly: false, hasShortfall: false, items: [] };
const CCM_ERROR: CcmOrderDisplay = { enabled: false, hasCcm: false, isCcmOnly: false, hasShortfall: false, items: [], fetchError: true };

export async function getOrderCcmDisplay(orderId: string): Promise<CcmOrderDisplay> {
  if (!isSupabaseConfigured()) return CCM_OFF;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_order_ccm_display", { p_order_id: orderId });
    if (error) return CCM_ERROR;
    if (!data) return CCM_OFF;
    const d = data as Record<string, unknown>;
    if (!d.enabled) return CCM_OFF;
    return {
      enabled: true,
      hasCcm: d.hasCcm === true,
      isCcmOnly: d.isCcmOnly === true,
      hasShortfall: d.hasShortfall === true,
      items: Array.isArray(d.items) ? (d.items as CcmOrderDisplay["items"]) : [],
    };
  } catch {
    return CCM_ERROR;
  }
}
