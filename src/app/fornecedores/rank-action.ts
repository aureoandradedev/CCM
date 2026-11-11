"use server";

import { createClient } from "@/lib/supabase/server";
import { rankAllProducts } from "@/lib/ranking/engine";
import type { RankableOffer, ProductRanking } from "@/lib/ranking/types";
import { getOperationalSupplierIds, filterOperationalOffers } from "@/lib/admin/supplier-guards";

export interface RankProductsResult {
  ok: boolean;
  error?: string;
  rankings?: ProductRanking[];
}

export async function rankProducts(
  masterProductIds?: string[],
): Promise<RankProductsResult> {
  const supabase = await createClient();

  // ── 1. Auth (somente admin) ────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Faça login para acessar ranking." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return {
      ok: false,
      error: "Somente administradores podem acessar o ranking.",
    };
  }

  // ── 2. Carregar ofertas elegíveis em lote (sem N+1) ────────────────────
  let query = supabase
    .from("supplier_offers")
    .select(
      "id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status",
    )
    .eq("status", "ativa")
    .is("replaced_at", null);

  if (masterProductIds && masterProductIds.length > 0) {
    query = query.in("master_product_id", masterProductIds);
  }

  const { data: rawOffers, error: offersErr } = await query;

  if (offersErr) {
    return { ok: false, error: "Erro ao carregar ofertas." };
  }

  if (!rawOffers || rawOffers.length === 0) {
    return { ok: true, rankings: [] };
  }

  // ── 3. Filtrar por fornecedores operacionais e executar ranking ─────────
  const operationalIds = await getOperationalSupplierIds(supabase);

  const allOffers: RankableOffer[] = rawOffers.map((o) => ({
    id: o.id as string,
    master_product_id: o.master_product_id as string,
    supplier_id: o.supplier_id as string,
    cost_centavos: o.cost_centavos as number,
    stock: o.stock as number | null,
    lead_time_days: o.lead_time_days as number,
    status: o.status as string,
  }));

  const offers = filterOperationalOffers(allOffers, operationalIds);
  const rankings = rankAllProducts(offers);

  return { ok: true, rankings };
}
