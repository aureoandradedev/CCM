"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CanonicalProduct } from "@/lib/integrations/types";

// ── Limites ──────────────────────────────────────────────────────────
const MAX_ITEMS = 5_000;
const BATCH_SIZE = 500;
const MAX_SKU = 100;
const MAX_NAME = 500;
const MAX_DESC = 5_000;
const MAX_BRAND = 200;
const MAX_CATEGORY = 200;
const MAX_UNIT = 20;
const MAX_URL = 2_048;
const MAX_SOURCE_NAME = 200;
const MAX_COST_REAIS = 100_000;
const MAX_STOCK = 999_999;

// ── Validação server-side (nunca confiar no frontend) ────────────────
const productSchema = z.object({
  sku: z.string().min(1).max(MAX_SKU),
  name: z.string().min(1).max(MAX_NAME),
  price: z.number().positive().max(MAX_COST_REAIS),
  stock: z.number().int().min(0).max(MAX_STOCK),
  gtin: z.string().max(20).optional(),
  description: z.string().max(MAX_DESC).optional(),
  brand: z.string().max(MAX_BRAND).optional(),
  category: z.string().max(MAX_CATEGORY).optional(),
  unit: z.string().max(MAX_UNIT).optional(),
  promoPrice: z.number().positive().max(MAX_COST_REAIS).optional(),
  weightKg: z.number().positive().max(10_000).optional(),
  images: z.array(z.string().max(MAX_URL)).max(10).optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
});

const importInputSchema = z.object({
  sourceType: z.enum(["csv", "xlsx", "manual"]),
  sourceName: z.string().max(MAX_SOURCE_NAME).optional(),
  products: z.array(productSchema).min(1).max(MAX_ITEMS),
  totals: z.object({
    total: z.number().int().min(0).max(MAX_ITEMS * 2),
    valid: z.number().int().min(0).max(MAX_ITEMS),
    invalid: z.number().int().min(0).max(MAX_ITEMS * 2),
    warnings: z.number().int().min(0).max(MAX_ITEMS * 2),
  }),
});

// ── Tipos de retorno ─────────────────────────────────────────────────

export interface CatalogImportInput {
  sourceType: "csv" | "xlsx" | "manual";
  sourceName: string;
  products: CanonicalProduct[];
  totals: { total: number; valid: number; invalid: number; warnings: number };
}

export interface CatalogImportResult {
  ok: boolean;
  catalogId?: string;
  error?: string;
  counts?: { total: number; inserted: number; errors: number; warnings: number };
}

// ── Server action ────────────────────────────────────────────────────

export async function importCatalog(input: CatalogImportInput): Promise<CatalogImportResult> {
  // ── 1. Validação server-side (payload pode ser forjado) ──
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Dados inválidos: ${issue?.path.join(".") || "?"} — ${issue?.message ?? "formato inesperado"}`,
    };
  }
  const data = parsed.data;

  // ── 2. Autenticação + supplier_id da sessão (NUNCA do input) ──
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Faça login para importar seu catálogo." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("supplier_id")
    .eq("id", user.id)
    .single();

  if (!profile?.supplier_id) {
    return { ok: false, error: "Sua conta não está vinculada a um fornecedor." };
  }

  const supplierId = profile.supplier_id;

  // ── 3. Criar catálogo (status=recebido; nunca "processando" síncrono) ──
  const source = data.sourceType === "manual" ? "manual" : "csv";

  const { data: catalog, error: catalogError } = await supabase
    .from("supplier_catalogs")
    .insert({
      supplier_id: supplierId,
      source,
      source_name: data.sourceName || null,
      status: "recebido",
      total_items: data.totals.total,
      processed: 0,
      errors: data.totals.invalid,
      warnings: data.totals.warnings,
    })
    .select("id")
    .single();

  if (catalogError || !catalog) {
    return { ok: false, error: "Erro ao criar catálogo. Tente novamente." };
  }

  // ── 4. Inserir itens em lotes — tudo ou nada ──
  // Se qualquer lote falha, apagamos o catálogo inteiro (ON DELETE CASCADE
  // em supplier_catalog_items.catalog_id remove itens parciais).
  const products = data.products;
  let insertedCount = 0;

  try {
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const rows = batch.map((p) => ({
        catalog_id: catalog.id,
        supplier_id: supplierId,
        supplier_sku: p.sku || null,
        ean: p.gtin || null,
        name: p.name,
        description: p.description || null,
        brand: p.brand || null,
        category_original: p.category || null,
        unit: p.unit || null,
        cost_centavos: p.price != null ? Math.round(p.price * 100) : null,
        stock: typeof p.stock === "number" ? p.stock : null,
        image_url: p.images?.[0] || null,
        attributes: {
          ...(p.weightKg != null ? { weight_kg: p.weightKg } : {}),
          ...(p.promoPrice != null
            ? { promo_price_centavos: Math.round(p.promoPrice * 100) }
            : {}),
          ...(p.images && p.images.length > 1
            ? { extra_images: p.images.slice(1) }
            : {}),
        },
        match_status: "pendente" as const,
      }));

      const { error: insertError } = await supabase
        .from("supplier_catalog_items")
        .insert(rows);

      if (insertError) throw insertError;
      insertedCount += batch.length;
    }
  } catch {
    // Falha parcial → apagar catálogo (cascade remove itens já inseridos)
    await supabase.from("supplier_catalogs").delete().eq("id", catalog.id);
    return { ok: false, error: "Erro ao salvar itens do catálogo. Nenhum dado foi gravado." };
  }

  // ── 5. Sucesso → atualizar status de uma vez ──
  await supabase
    .from("supplier_catalogs")
    .update({ status: "analisado", processed: insertedCount })
    .eq("id", catalog.id);

  return {
    ok: true,
    catalogId: catalog.id,
    counts: {
      total: data.totals.total,
      inserted: insertedCount,
      errors: data.totals.invalid,
      warnings: data.totals.warnings,
    },
  };
}
