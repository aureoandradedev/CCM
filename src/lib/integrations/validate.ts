/**
 * Transformação linha→produto canônico + validação (zod) + resumo da importação.
 * É o "adapter" do método CSV/feed: pega as linhas da origem já mapeadas e
 * devolve `CanonicalProduct` validados, com erros/avisos por linha.
 */
import { z } from "zod";

import { parseImages, parseNumberBR, parseStatus, type ColumnMapping } from "./mapping";
import type { CanonicalProduct, ImportSummary, RowResult } from "./types";

/** Schema canônico mínimo para um produto entrar na loja. */
export const canonicalProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU obrigatório"),
  name: z.string().trim().min(2, "Nome muito curto"),
  price: z.number({ error: "Preço inválido" }).positive("Preço deve ser maior que zero"),
  stock: z.number({ error: "Estoque inválido" }).int("Estoque deve ser inteiro").min(0, "Estoque negativo"),
  gtin: z.string().trim().optional(),
  description: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  category: z.string().trim().optional(),
  promoPrice: z.number().positive().optional(),
  unit: z.string().trim().optional(),
  weightKg: z.number().positive().optional(),
  images: z.array(z.string().url()).optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
});

/** Monta um produto canônico (parcial) a partir de uma linha + mapeamento. */
function buildProduct(raw: Record<string, string>, mapping: ColumnMapping) {
  const get = (key: keyof CanonicalProduct) => {
    const col = mapping[key];
    return col ? raw[col] : undefined;
  };

  const product: Record<string, unknown> = {
    sku: (get("sku") ?? "").trim(),
    name: (get("name") ?? "").trim(),
    price: parseNumberBR(get("price")),
    stock: (() => {
      const n = parseNumberBR(get("stock"));
      return n == null ? null : Math.trunc(n);
    })(),
  };

  const gtin = get("gtin")?.trim();
  if (gtin) product.gtin = gtin;
  const description = get("description")?.trim();
  if (description) product.description = description;
  const brand = get("brand")?.trim();
  if (brand) product.brand = brand;
  const category = get("category")?.trim();
  if (category) product.category = category;
  const unit = get("unit")?.trim();
  if (unit) product.unit = unit;

  const promo = parseNumberBR(get("promoPrice"));
  if (promo != null) product.promoPrice = promo;
  const weight = parseNumberBR(get("weightKg"));
  if (weight != null) product.weightKg = weight;
  const images = parseImages(get("images"));
  if (images) product.images = images;
  const status = parseStatus(get("status"));
  if (status) product.status = status;

  return product;
}

/** Valida uma linha e devolve o resultado (produto ou erros). */
export function validateRow(index: number, raw: Record<string, string>, mapping: ColumnMapping): RowResult {
  const draft = buildProduct(raw, mapping);
  const parsed = canonicalProductSchema.safeParse(draft);
  const warnings: string[] = [];

  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const field = i.path[0] ? `${String(i.path[0])}: ` : "";
      return `${field}${i.message}`;
    });
    return { index, raw, errors, warnings };
  }

  const product = parsed.data as CanonicalProduct;
  // avisos não bloqueiam a venda, mas sinalizam revisão
  if (!product.gtin) warnings.push("Sem EAN/GTIN");
  if (!product.images?.length) warnings.push("Sem imagem");
  if (!product.category) warnings.push("Sem categoria");
  if (product.promoPrice != null && product.promoPrice >= product.price) {
    warnings.push("Preço promocional não é menor que o preço");
  }

  return { index, raw, product, errors: [], warnings };
}

/** Processa a tabela inteira e monta o resumo das etapas 3 e 4 do wizard. */
export function buildSummary(rows: Record<string, string>[], mapping: ColumnMapping): ImportSummary {
  const results = rows.map((raw, i) => validateRow(i, raw, mapping));

  const valid = results.filter((r) => r.product).length;
  const invalid = results.length - valid;
  const warnings = results.filter((r) => r.product && r.warnings.length > 0).length;
  const withStock = results.filter((r) => (r.product?.stock ?? 0) > 0).length;
  const withPrice = results.filter((r) => (r.product?.price ?? 0) > 0).length;
  const withImages = results.filter((r) => (r.product?.images?.length ?? 0) > 0).length;

  return {
    total: results.length,
    valid,
    invalid,
    warnings,
    withStock,
    withPrice,
    withImages,
    rows: results,
  };
}
