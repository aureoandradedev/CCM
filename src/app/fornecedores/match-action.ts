"use server";

import { createClient } from "@/lib/supabase/server";
import { buildMasterIndex, matchItems } from "@/lib/matching/engine";
import type { MasterProductRow, MatchableItem, MatchResult } from "@/lib/matching/types";
import type { NormalizedData } from "@/lib/normalization/types";

const BATCH_SIZE = 500;

export interface MatchCatalogResult {
  ok: boolean;
  error?: string;
  counts?: {
    total: number;
    match_sugerido: number;
    revisao_manual: number;
    sem_match: number;
    errors: number;
  };
}

export async function matchCatalog(
  catalogId: string,
): Promise<MatchCatalogResult> {
  const supabase = await createClient();

  // ── 1. Auth (somente admin) ────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Faça login para executar matching." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return { ok: false, error: "Somente administradores podem executar matching." };
  }

  // ── 2. Verificar catálogo ─────────────────────────────────────────────
  const { data: catalog, error: catErr } = await supabase
    .from("supplier_catalogs")
    .select("id, supplier_id, status")
    .eq("id", catalogId)
    .single();

  if (catErr || !catalog) {
    return { ok: false, error: "Catálogo não encontrado." };
  }

  const MATCHABLE = ["concluido", "com_erros"];
  if (!MATCHABLE.includes(catalog.status)) {
    return {
      ok: false,
      error: `Catálogo com status "${catalog.status}" não pode ser processado para matching. Esperado: ${MATCHABLE.join(", ")}.`,
    };
  }

  // ── 3. Carregar itens normalizados ────────────────────────────────────
  const { data: rawItems, error: itemsErr } = await supabase
    .from("supplier_catalog_items")
    .select("id, catalog_id, normalized_data")
    .eq("catalog_id", catalogId)
    .eq("match_status", "normalizado");

  if (itemsErr) {
    return { ok: false, error: "Erro ao carregar itens do catálogo." };
  }

  if (!rawItems || rawItems.length === 0) {
    const { count: sugeridoCount } = await supabase
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "match_sugerido");
    const { count: revisaoCount } = await supabase
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "revisao_manual");
    const { count: totalCount } = await supabase
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId);

    const total = totalCount ?? 0;
    const sugerido = sugeridoCount ?? 0;
    const revisao = revisaoCount ?? 0;

    return {
      ok: true,
      counts: {
        total,
        match_sugerido: sugerido,
        revisao_manual: revisao,
        sem_match: total - sugerido - revisao,
        errors: 0,
      },
    };
  }

  const items: MatchableItem[] = rawItems
    .filter((r) => r.normalized_data != null)
    .map((r) => ({
      id: r.id as string,
      catalog_id: r.catalog_id as string,
      normalized_data: r.normalized_data as NormalizedData,
    }));

  if (items.length === 0) {
    return { ok: false, error: "Nenhum item com dados normalizados para matching." };
  }

  // ── 4. Carregar master products UMA VEZ ───────────────────────────────
  const { data: mastersRaw, error: mastersErr } = await supabase
    .from("master_products")
    .select("id, ean, name, brand_slug, model, category_slug, subcategory_slug, unit, pack_info, specs")
    .eq("active", true);

  if (mastersErr) {
    return { ok: false, error: "Erro ao carregar produtos mestres." };
  }

  const masters = (mastersRaw ?? []) as MasterProductRow[];

  if (masters.length === 0) {
    return { ok: false, error: "Nenhum produto mestre cadastrado. Matching impossível." };
  }

  // ── 5. Construir índice e executar matching em memória ────────────────
  const idx = buildMasterIndex(masters);
  const results = matchItems(items, idx);

  // ── 6. Persistir em lotes via RPC ─────────────────────────────────────
  let totalUpdated = 0;
  let errors = 0;

  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    const payload = batch.map((r: MatchResult) => ({
      id: r.item_id,
      match_status: r.match_status,
      master_product_id: r.master_product_id ?? "",
      match_confidence: r.match_confidence,
      match_signals: r.match_signals,
    }));

    const { data: count, error: rpcErr } = await supabase.rpc(
      "update_match_results",
      { p_catalog_id: catalogId, p_items: payload },
    );

    if (rpcErr) {
      errors += batch.length;
    } else {
      totalUpdated += (count as number) ?? 0;
    }
  }

  // ── 7. Contar estado real no banco ────────────────────────────────────
  const [{ count: sugeridoFinal }, { count: revisaoFinal }, { count: totalFinal }] =
    await Promise.all([
      supabase
        .from("supplier_catalog_items")
        .select("*", { count: "exact", head: true })
        .eq("catalog_id", catalogId)
        .eq("match_status", "match_sugerido"),
      supabase
        .from("supplier_catalog_items")
        .select("*", { count: "exact", head: true })
        .eq("catalog_id", catalogId)
        .eq("match_status", "revisao_manual"),
      supabase
        .from("supplier_catalog_items")
        .select("*", { count: "exact", head: true })
        .eq("catalog_id", catalogId),
    ]);

  const total = totalFinal ?? 0;
  const sugerido = sugeridoFinal ?? 0;
  const revisao = revisaoFinal ?? 0;

  return {
    ok: errors === 0,
    counts: {
      total,
      match_sugerido: sugerido,
      revisao_manual: revisao,
      sem_match: total - sugerido - revisao,
      errors,
    },
    ...(errors > 0
      ? { error: `${errors} item(s) não puderam ser atualizados.` }
      : {}),
  };
}
