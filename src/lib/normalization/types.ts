/** Resultado da normalização de um item de catálogo. */
export interface NormalizedData {
  name_normalized: string;
  name_tokens: string[];

  brand_slug: string | null;
  brand_normalized: string;
  brand_status: "matched" | "unmatched";

  model_key: string | null;
  model_original: string | null;

  ean_clean: string | null;
  ean_valid: boolean;
  ean_format: "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14" | null;

  unit_normalized: string;

  category_slug: string | null;
  subcategory_slug: string | null;
  category_status: "matched" | "unmatched";

  pack_qty: number | null;
  pack_unit: string | null;

  attributes: Record<string, string | number>;
}

/** Linha bruta de supplier_catalog_items como vem do banco. */
export interface CatalogItemRow {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  ean: string | null;
  unit: string | null;
  pack_info: string | null;
  category_original: string | null;
  subcategory_original: string | null;
  description: string | null;
  supplier_sku: string | null;
}

export interface SubcategoryRef {
  slug: string;
  name: string;
  normalized: string;
}

/** Dados de referência carregados uma vez do banco. */
export interface ReferenceData {
  brands: Map<string, string>;
  categories: Map<string, string>;
  subcategories: Map<string, SubcategoryRef[]>;
}
