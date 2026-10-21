"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeItems } from "@/lib/normalization/normalizers";
import type { CatalogItemRow, ReferenceData, SubcategoryRef } from "@/lib/normalization/types";

const BATCH_SIZE = 500;

export interface NormalizeCatalogResult {
  ok: boolean;
  error?: string;
  counts?: { total: number; normalized: number; errors: number };
}

export async function normalizeCatalog(
  catalogId: string,
): Promise<NormalizeCatalogResult> {
  const supabase = await createClient();

  // ── 1. Auth ───────────────────────────────────────────────────────────
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Faça login para normalizar o catálogo." };
  }

  // ── 2. Verificar que catálogo existe e pertence ao fornecedor ─────────
  const { data: catalog, error: catErr } = await supabase
    .from("supplier_catalogs")
    .select("id, supplier_id, status")
    .eq("id", catalogId)
    .single();

  if (catErr || !catalog) {
    return { ok: false, error: "Catálogo não encontrado." };
  }

  const NORMALIZABLE = ["analisado", "com_erros", "concluido"];
  if (!NORMALIZABLE.includes(catalog.status)) {
    return {
      ok: false,
      error: `Catálogo com status "${catalog.status}" não pode ser normalizado. Esperado: ${NORMALIZABLE.join(", ")}.`,
    };
  }

  // ── 3. Carregar itens pendentes ───────────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from("supplier_catalog_items")
    .select(
      "id, name, brand, model, ean, unit, pack_info, category_original, subcategory_original, description, supplier_sku",
    )
    .eq("catalog_id", catalogId)
    .eq("match_status", "pendente");

  if (itemsErr) {
    return { ok: false, error: "Erro ao carregar itens do catálogo." };
  }

  if (!items || items.length === 0) {
    if (catalog.status === "concluido") {
      const { count: totalCount } = await supabase
        .from("supplier_catalog_items")
        .select("*", { count: "exact", head: true })
        .eq("catalog_id", catalogId);
      return {
        ok: true,
        counts: { total: totalCount ?? 0, normalized: totalCount ?? 0, errors: 0 },
      };
    }
    return { ok: false, error: "Nenhum item pendente para normalizar." };
  }

  // ── 4. Carregar referências UMA VEZ (evita N+1) ──────────────────────
  const refs = await loadReferenceData(supabase);

  // ── 5. Normalizar todos em memória ────────────────────────────────────
  const normalized = normalizeItems(items as CatalogItemRow[], refs);

  // ── 6. Persistir em lotes via RPC ─────────────────────────────────────
  let totalUpdated = 0;
  let errors = 0;

  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const batch = normalized.slice(i, i + BATCH_SIZE);
    const payload = batch.map((n) => ({
      id: n.id,
      normalized_data: n.normalizedData,
      match_status: n.matchStatus,
    }));

    const { data: count, error: rpcErr } = await supabase.rpc(
      "update_normalized_items",
      { p_catalog_id: catalogId, p_items: payload },
    );

    if (rpcErr) {
      errors += batch.length;
    } else {
      totalUpdated += (count as number) ?? 0;
    }
  }

  // ── 7. Contar estado real do catálogo no banco ────────────────────────
  const [{ count: normalizedCount }, { count: pendingCount }] = await Promise.all([
    supabase
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "normalizado"),
    supabase
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId)
      .eq("match_status", "pendente"),
  ]);

  const dbNormalized = normalizedCount ?? 0;
  const dbPending = pendingCount ?? 0;
  const newStatus = errors > 0 || dbPending > 0 ? "com_erros" : "concluido";

  await supabase
    .from("supplier_catalogs")
    .update({ status: newStatus, processed: dbNormalized })
    .eq("id", catalogId);

  return {
    ok: errors === 0 && dbPending === 0,
    counts: { total: items.length, normalized: dbNormalized, errors: errors + dbPending },
    ...(errors > 0
      ? { error: `${errors} item(s) não puderam ser atualizados.` }
      : {}),
  };
}

// ── Carregamento de referências (1 query por tabela) ────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

async function loadReferenceData(
  supabase: SupabaseClient,
): Promise<ReferenceData> {
  const [brandsRes, catsRes, subsRes] = await Promise.all([
    supabase.from("brands").select("slug, name"),
    supabase.from("categories").select("slug, name").eq("active", true),
    supabase.from("subcategories").select("slug, name, category_slug"),
  ]);

  // Brands: nome normalizado → slug, slug → slug
  const brands = new Map<string, string>();
  for (const b of brandsRes.data ?? []) {
    brands.set(normalizeText(b.name), b.slug);
    brands.set(b.slug, b.slug);
  }

  // Categories: nome normalizado → slug, slug → slug
  const categories = new Map<string, string>();
  for (const c of catsRes.data ?? []) {
    categories.set(normalizeText(c.name), c.slug);
    categories.set(c.slug, c.slug);
  }

  // Subcategories: agrupadas por category_slug
  const subcategories = new Map<string, SubcategoryRef[]>();
  for (const s of subsRes.data ?? []) {
    const catSlug = s.category_slug as string;
    if (!subcategories.has(catSlug)) subcategories.set(catSlug, []);
    subcategories.get(catSlug)!.push({
      slug: s.slug,
      name: s.name,
      normalized: normalizeText(s.name),
    });
  }

  return { brands, categories, subcategories };
}
