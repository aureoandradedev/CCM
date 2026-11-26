import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface SupplierRequestRow {
  id: string;
  order_id: string;
  supplier_id: string;
  status: string;
  round_number: number;
  role: "vencedor" | "reserva" | "manual";
  sent_at: string;
  viewed_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  handoff_at: string | null;
  transferred_from_request_id: string | null;
  created_at: string;
}

export interface SupplierRequestLineRow {
  id: string;
  supplier_request_id: string;
  order_item_id: string;
  master_product_id: string | null;
  product_name: string;
  quantity_requested: number;
  unit: string | null;
  unit_cost_centavos: number;
  quantity_confirmed: number | null;
  status: string | null;
  cost_confirmed_centavos: number | null;
  notes: string | null;
}

export interface SupplierRequestMirror {
  id: string;
  file_path: string;
  file_type: string;
  notes: string | null;
  created_at: string;
}

const REQ_COLUMNS = "id, order_id, supplier_id, status, round_number, role, sent_at, viewed_at, responded_at, expires_at, handoff_at, transferred_from_request_id, created_at";

const LINE_COLUMNS = "id, supplier_request_id, order_item_id, master_product_id, product_name, quantity_requested, unit, unit_cost_centavos, quantity_confirmed, status, cost_confirmed_centavos, notes";

export async function listSupplierRequests(supplierId: string): Promise<SupplierRequestRow[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_requests")
    .select(REQ_COLUMNS)
    .eq("supplier_id", supplierId)
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data as SupplierRequestRow[] | null) ?? [];
}

export interface LineClaimInfo {
  order_item_id: string;
  qty_claimed: number;
}

export async function getSupplierRequest(requestId: string, supplierId: string): Promise<{ request: SupplierRequestRow; lines: SupplierRequestLineRow[]; mirrors: SupplierRequestMirror[]; claims: LineClaimInfo[] } | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = await createClient();
  const { data: request } = await sb
    .from("supplier_requests")
    .select(REQ_COLUMNS)
    .eq("id", requestId)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (!request) return null;

  const [linesRes, mirrorsRes, claimsRes] = await Promise.all([
    sb.from("supplier_request_lines").select(LINE_COLUMNS).eq("supplier_request_id", requestId).order("product_name"),
    sb.from("supplier_request_mirrors").select("id, file_path, file_type, notes, created_at").eq("supplier_request_id", requestId).eq("supplier_id", supplierId).order("created_at", { ascending: false }),
    sb.from("supplier_request_line_claims").select("order_item_id, qty_claimed").eq("supplier_request_id", requestId),
  ]);

  // G6: Mark as viewed (idempotent)
  if (!request.viewed_at) {
    await sb.rpc("mark_request_viewed", { p_request_id: requestId }).then(() => {});
  }

  return {
    request: request as SupplierRequestRow,
    lines: (linesRes.data as SupplierRequestLineRow[] | null) ?? [],
    mirrors: (mirrorsRes.data as SupplierRequestMirror[] | null) ?? [],
    claims: (claimsRes.data as LineClaimInfo[] | null) ?? [],
  };
}
