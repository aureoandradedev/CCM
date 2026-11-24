import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface SupplierPORow {
  id: string;
  supplier_id: string;
  cycle_date: string;
  status: string;
  supplier_confirmation_status: string;
  supplier_confirmed_at: string | null;
  subtotal_centavos: number;
  total_centavos: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface SupplierPOItemRow {
  id: string;
  purchase_order_id: string;
  master_product_id: string;
  product_name: string;
  quantity_units: number;
  unit_cost_centavos: number;
  subtotal_centavos: number;
  unidade_compra: string;
  qty_supplier_confirmed: number | null;
  supplier_item_status: string | null;
  cost_supplier_confirmed_centavos: number | null;
  supplier_notes: string | null;
}

export interface SupplierPOMirror {
  id: string;
  file_path: string;
  file_type: string;
  notes: string | null;
  created_at: string;
}

const PO_COLUMNS = "id, supplier_id, cycle_date, status, supplier_confirmation_status, supplier_confirmed_at, subtotal_centavos, total_centavos, item_count, created_at, updated_at";

const PO_ITEM_COLUMNS = "id, purchase_order_id, master_product_id, product_name, quantity_units, unit_cost_centavos, subtotal_centavos, unidade_compra, qty_supplier_confirmed, supplier_item_status, cost_supplier_confirmed_centavos, supplier_notes";

export async function listSupplierPOs(supplierId: string): Promise<SupplierPORow[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_purchase_orders")
    .select(PO_COLUMNS)
    .eq("supplier_id", supplierId)
    .in("supplier_confirmation_status", [
      "aguardando_confirmacao_fornecedor",
      "confirmado",
      "confirmado_parcial",
      "divergencia",
      "revisao_necessaria",
    ])
    .order("created_at", { ascending: false })
    .limit(100);
  return (data as SupplierPORow[] | null) ?? [];
}

export async function getSupplierPO(poId: string, supplierId: string): Promise<{ po: SupplierPORow; items: SupplierPOItemRow[]; mirrors: SupplierPOMirror[] } | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = await createClient();
  const { data: po } = await sb
    .from("supplier_purchase_orders")
    .select(PO_COLUMNS)
    .eq("id", poId)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (!po) return null;

  const [itemsRes, mirrorsRes] = await Promise.all([
    sb.from("purchase_order_items").select(PO_ITEM_COLUMNS).eq("purchase_order_id", poId).order("product_name"),
    sb.from("po_mirrors").select("id, file_path, file_type, notes, created_at").eq("purchase_order_id", poId).eq("supplier_id", supplierId).order("created_at", { ascending: false }),
  ]);

  return {
    po: po as SupplierPORow,
    items: (itemsRes.data as SupplierPOItemRow[] | null) ?? [],
    mirrors: (mirrorsRes.data as SupplierPOMirror[] | null) ?? [],
  };
}
