import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ReceivingSessionRow } from "@/lib/admin/types";

const configured = () => isSupabaseConfigured();

export interface RecebedorPO {
  id: string;
  supplier_id: string;
  supplier_name: string | null;
  cycle_date: string;
  status: string;
  item_count: number;
  activeSession: ReceivingSessionRow | null;
}

export interface RecebedorPOItem {
  id: string;
  master_product_id: string;
  product_name: string;
  quantity_units: number;
  pack_count: number;
  unidade_compra: string;
  qtd_por_embalagem: number;
}

export async function readPendingPOs(): Promise<RecebedorPO[]> {
  if (!configured()) return [];
  const sb = await createClient();

  const { data: pos, error } = await sb.rpc("recebedor_pending_pos");

  if (error || !pos || pos.length === 0) return [];

  const poIds = pos.map((po: { id: string }) => po.id);
  const { data: sessions } = await sb
    .from("receiving_sessions")
    .select("*")
    .in("purchase_order_id", poIds)
    .eq("status", "in_progress");

  const sessionByPo = new Map((sessions ?? []).map((s) => [s.purchase_order_id, s]));

  return pos.map((po: { id: string; supplier_id: string; supplier_name: string | null; cycle_date: string; status: string; item_count: number }) => ({
    id: po.id,
    supplier_id: po.supplier_id,
    supplier_name: po.supplier_name,
    cycle_date: po.cycle_date,
    status: po.status,
    item_count: po.item_count,
    activeSession: (sessionByPo.get(po.id) as ReceivingSessionRow | undefined) ?? null,
  }));
}

export async function readPODetail(poId: string) {
  if (!configured()) return null;
  const sb = await createClient();

  const [poRes, itemsRes, sessionRes] = await Promise.all([
    sb.rpc("recebedor_po_detail", { p_po_id: poId }),
    sb.rpc("recebedor_po_items", { p_po_id: poId }),
    sb.from("receiving_sessions")
      .select("*")
      .eq("purchase_order_id", poId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (poRes.error || !poRes.data || poRes.data.length === 0) return null;

  const po = poRes.data[0] as {
    id: string; supplier_id: string; supplier_name: string | null;
    cycle_date: string; status: string; item_count: number;
  };

  return {
    po,
    items: (itemsRes.data as RecebedorPOItem[] | null) ?? [],
    session: (sessionRes.data as ReceivingSessionRow | null) ?? null,
  };
}

export async function readRecentSessions(): Promise<ReceivingSessionRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("receiving_sessions")
    .select("*, supplier_purchase_orders(supplier_id, cycle_date, status, suppliers(name))")
    .order("started_at", { ascending: false })
    .limit(10);
  return (data as ReceivingSessionRow[] | null) ?? [];
}
