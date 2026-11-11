import type { SupabaseClient } from "@supabase/supabase-js";
import type { RankableOffer } from "@/lib/ranking/types";

/**
 * IDs de fornecedores com condições comerciais ativas (active=true, valid_to IS NULL,
 * pedido_minimo_tipo='valor'). Espelha is_supplier_operationally_active() do SQL.
 */
export async function getOperationalSupplierIds(
  sb: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await sb
    .from("supplier_commercial_terms")
    .select("supplier_id")
    .eq("active", true)
    .is("valid_to", null)
    .eq("pedido_minimo_tipo", "valor");

  return new Set((data ?? []).map((r) => r.supplier_id as string));
}

export function filterOperationalOffers(
  offers: RankableOffer[],
  operationalIds: Set<string>,
): RankableOffer[] {
  return offers.filter((o) => operationalIds.has(o.supplier_id));
}
