"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import type { CanonicalProduct } from "@/lib/integrations/types";
import { processCatalogScoped, type ScopedCatalogResult } from "@/lib/admin/catalog-processor";

const MAX_ITEMS = 5_000;
const BATCH_SIZE = 500;

const productSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  price: z.number().positive().max(100_000),
  stock: z.number().int().min(0).max(999_999),
  gtin: z.string().max(20).optional(),
  description: z.string().max(5_000).optional(),
  brand: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  subcategory: z.string().max(200).optional(),
  unit: z.string().max(20).optional(),
  packInfo: z.string().max(100).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  promoPrice: z.number().positive().max(100_000).optional(),
  weightKg: z.number().positive().max(10_000).optional(),
  images: z.array(z.string().max(2_048)).max(10).optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
});

const importInputSchema = z.object({
  sourceType: z.enum(["csv", "xlsx", "manual"]),
  sourceName: z.string().max(200).optional(),
  products: z.array(productSchema).min(1).max(MAX_ITEMS),
  totals: z.object({
    total: z.number().int().min(0).max(MAX_ITEMS * 2),
    valid: z.number().int().min(0).max(MAX_ITEMS),
    invalid: z.number().int().min(0).max(MAX_ITEMS * 2),
    warnings: z.number().int().min(0).max(MAX_ITEMS * 2),
  }),
});

export interface AdminImportInput {
  supplierId: string;
  sourceType: "csv" | "xlsx" | "manual";
  sourceName: string;
  products: CanonicalProduct[];
  totals: { total: number; valid: number; invalid: number; warnings: number };
}

export interface AdminImportResult {
  ok: boolean;
  catalogId?: string;
  error?: string;
  counts?: { total: number; inserted: number; errors: number; warnings: number };
  processing?: ScopedCatalogResult;
}

export async function adminImportCatalog(input: AdminImportInput): Promise<AdminImportResult> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "Acesso negado." };
  }

  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Dados inválidos: ${issue?.path.join(".") || "?"} — ${issue?.message ?? "formato inesperado"}` };
  }
  const data = parsed.data;

  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("id", input.supplierId)
    .single();
  if (!supplier) return { ok: false, error: "Fornecedor não encontrado." };

  const source = data.sourceType === "manual" ? "manual" : "csv";

  const { data: catalog, error: catalogError } = await supabase
    .from("supplier_catalogs")
    .insert({
      supplier_id: input.supplierId,
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

  const products = data.products;
  let insertedCount = 0;

  try {
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const rows = batch.map((p) => ({
        catalog_id: catalog.id,
        supplier_id: input.supplierId,
        supplier_sku: p.sku || null,
        ean: p.gtin || null,
        name: p.name,
        description: p.description || null,
        brand: p.brand || null,
        model: p.model || null,
        category_original: p.category || null,
        subcategory_original: p.subcategory || null,
        unit: p.unit || null,
        pack_info: p.packInfo || null,
        cost_centavos: p.price != null ? Math.round(p.price * 100) : null,
        stock: typeof p.stock === "number" ? p.stock : null,
        lead_time_days: typeof p.leadTimeDays === "number" ? p.leadTimeDays : null,
        image_url: p.images?.[0] || null,
        attributes: {
          ...(p.weightKg != null ? { weight_kg: p.weightKg } : {}),
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
    await supabase.from("supplier_catalogs").delete().eq("id", catalog.id);
    return { ok: false, error: "Erro ao salvar itens do catálogo. Nenhum dado foi gravado." };
  }

  await supabase
    .from("supplier_catalogs")
    .update({ status: "recebido", processed: 0 })
    .eq("id", catalog.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processing = await processCatalogScoped(supabase as any, catalog.id);

  revalidatePath("/admin/fornecedores", "layout");
  revalidatePath("/admin/compras", "layout");

  return {
    ok: true,
    catalogId: catalog.id,
    counts: {
      total: data.totals.total,
      inserted: insertedCount,
      errors: data.totals.invalid,
      warnings: data.totals.warnings,
    },
    processing,
  };
}
