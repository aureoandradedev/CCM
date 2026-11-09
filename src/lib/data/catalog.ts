import { cache } from "react";
import type {
  Banner,
  Brand,
  Category,
  Inspiration,
  Product,
  ProductQuery,
  ProductQueryResult,
  QuickLink,
  Supplier,
} from "@/types/catalog";
import { createPublicClient } from "@/lib/supabase/public";
import { scoreItem, normalize } from "@/lib/utils/search";
import { hasWholesale, offerDiscountPct } from "@/lib/pricing";
import { mockCatalog } from "./mock";

/**
 * Camada de dados do catálogo.
 *
 * Fonte: Supabase quando `.env.local` está configurado; senão, o mock.
 * Todas as páginas consomem SÓ estas funções, então trocar a origem dos dados
 * (fornecedor via API, ERP, etc.) não mexe em componente nenhum.
 */

/* ----------------------------- linhas do banco ---------------------------- */

interface ProductRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  brand_name: string;
  brand_slug: string;
  category_slug: string;
  subcategory_slug: string | null;
  unit: string;
  pack_info: string | null;
  retail_price: number | string;
  wholesale_price: number | string | null;
  wholesale_min_qty: number | null;
  list_price: number | string | null;
  pix_discount_pct: number | null;
  images: string[] | null;
  rating: number | string | null;
  review_count: number | null;
  badges: string[] | null;
  short_description: string;
  description: string | null;
  specs: { label: string; value: string }[] | null;
  stock_status: Product["stockStatus"];
  tags: string[] | null;
  yield_hint: string | null;
  sale_mode: string | null;
  unidade_compra: string | null;
  qtd_por_embalagem: number | null;
  package_discount_pct: number | null;
  expected_availability_date: string | null;
}

interface CategoryRow {
  slug: string;
  name: string;
  icon: string;
  description: string;
  image: string | null;
  tone: Category["tone"] | null;
  subcategories: { slug: string; name: string; sort: number }[] | null;
}

function num(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function mapProduct(r: ProductRow): Product {
  return {
    id: r.id,
    slug: r.slug,
    sku: r.sku,
    name: r.name,
    brand: r.brand_name,
    brandSlug: r.brand_slug,
    categorySlug: r.category_slug,
    subcategorySlug: r.subcategory_slug ?? undefined,
    unit: r.unit,
    packInfo: r.pack_info ?? undefined,
    retailPrice: num(r.retail_price) ?? 0,
    wholesalePrice: num(r.wholesale_price),
    wholesaleMinQty: r.wholesale_min_qty ?? undefined,
    listPrice: num(r.list_price),
    pixDiscountPct: r.pix_discount_pct ?? undefined,
    images: r.images ?? [],
    rating: num(r.rating),
    reviewCount: r.review_count ?? undefined,
    badges: (r.badges ?? []) as Product["badges"],
    shortDescription: r.short_description,
    description: r.description ?? undefined,
    specs: r.specs ?? undefined,
    supplier: undefined,
    stockStatus: r.stock_status,
    tags: r.tags ?? undefined,
    yieldHint: r.yield_hint ?? undefined,
    saleMode: r.sale_mode ?? undefined,
    unidadeCompra: r.unidade_compra ?? undefined,
    qtdPorEmbalagem: r.qtd_por_embalagem ?? undefined,
    packageDiscountPct: r.package_discount_pct != null ? Number(r.package_discount_pct) : undefined,
    expectedAvailabilityDate: r.expected_availability_date ?? undefined,
  };
}

function mapCategory(r: CategoryRow): Category {
  return {
    slug: r.slug,
    name: r.name,
    icon: r.icon,
    description: r.description,
    image: r.image ?? undefined,
    tone: r.tone ?? undefined,
    children: (r.subcategories ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((s) => ({ slug: s.slug, name: s.name })),
  };
}

const PRODUCT_SELECT =
  "id, slug, sku, name, brand_name, brand_slug, category_slug, subcategory_slug, unit, pack_info, retail_price, wholesale_price, wholesale_min_qty, list_price, pix_discount_pct, images, rating, review_count, badges, short_description, description, specs, stock_status, tags, yield_hint, sale_mode, unidade_compra, qtd_por_embalagem, package_discount_pct, expected_availability_date";

/* ------------------------------ carregamento ------------------------------ */

const loadAllProducts = cache(async (): Promise<Product[]> => {
  const sb = createPublicClient();
  if (!sb) return mockCatalog.products;
  const { data, error } = await sb
    .from("products_public")
    .select(PRODUCT_SELECT)
    .neq("sale_mode", "nao_vender")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error || !data) {
    console.error("[catalog] falha ao carregar produtos, usando mock:", error?.message);
    return mockCatalog.products;
  }
  return (data as unknown as ProductRow[]).map(mapProduct);
});

export async function getCategories(): Promise<Category[]> {
  const sb = createPublicClient();
  if (!sb) return mockCatalog.categories;
  const { data, error } = await sb
    .from("categories")
    .select("slug, name, icon, description, image, tone, subcategories(slug, name, sort)")
    .eq("active", true)
    .order("sort", { ascending: true });
  if (error || !data) {
    console.error("[catalog] falha ao carregar categorias, usando mock:", error?.message);
    return mockCatalog.categories;
  }
  return (data as unknown as CategoryRow[]).map(mapCategory);
}

export async function getCategory(slug: string): Promise<Category | null> {
  const list = await getCategories();
  return list.find((c) => c.slug === slug) ?? null;
}

export async function getBrands(): Promise<Brand[]> {
  const sb = createPublicClient();
  if (!sb) return mockCatalog.brands;
  const { data } = await sb.from("brands").select("slug, name").order("name");
  return (data as Brand[] | null) ?? mockCatalog.brands;
}

export async function getSuppliers(): Promise<Supplier[]> {
  return mockCatalog.suppliers;
}

export async function getBanners(): Promise<Banner[]> {
  const sb = createPublicClient();
  if (!sb) return mockCatalog.banners;
  const { data } = await sb
    .from("banners")
    .select("id, eyebrow, title, subtitle, cta, href, image, theme, variant")
    .eq("active", true)
    .order("sort");
  return (data as Banner[] | null)?.length ? (data as Banner[]) : mockCatalog.banners;
}

export async function getQuickLinks(): Promise<QuickLink[]> {
  return mockCatalog.quickLinks;
}

export async function getInspirations(): Promise<Inspiration[]> {
  return mockCatalog.inspirations;
}

/* --------------------------------- consultas -------------------------------- */

function sortProducts(items: Product[], sort: ProductQuery["sort"], search?: string): Product[] {
  const arr = items.slice();
  switch (sort) {
    case "price-asc":
      return arr.sort((a, b) => a.retailPrice - b.retailPrice);
    case "price-desc":
      return arr.sort((a, b) => b.retailPrice - a.retailPrice);
    case "name":
      return arr.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    case "newest":
      return arr.reverse();
    case "relevance":
    default:
      if (search) {
        const q = normalize(search);
        return arr
          .map((p) => ({ p, s: scoreItem({ id: p.id, name: p.name, brand: p.brand, category: p.categorySlug, tags: p.tags, sku: p.sku }, q) }))
          .sort((a, b) => b.s - a.s)
          .map((x) => x.p);
      }
      // relevância padrão: mais vendidos e ofertas primeiro, depois avaliação
      return arr.sort((a, b) => weight(b) - weight(a));
  }
}

function weight(p: Product): number {
  let w = (p.rating ?? 0) * 10 + Math.min(p.reviewCount ?? 0, 500) / 50;
  if (p.badges?.includes("mais-vendido")) w += 40;
  if (p.badges?.includes("oferta")) w += 25;
  if (p.badges?.includes("lancamento") || p.badges?.includes("novo")) w += 10;
  return w;
}

export async function getProducts(query: ProductQuery = {}): Promise<ProductQueryResult> {
  const all = await loadAllProducts();
  let items = all;

  if (query.category) items = items.filter((p) => p.categorySlug === query.category);
  if (query.subcategory) items = items.filter((p) => p.subcategorySlug === query.subcategory);
  if (query.brand) items = items.filter((p) => p.brandSlug === query.brand);
  if (query.onlyWholesale) items = items.filter(hasWholesale);
  if (query.onlyOffers) items = items.filter((p) => offerDiscountPct(p) > 0 || p.badges?.includes("oferta"));
  if (query.search) {
    const q = normalize(query.search);
    items = items.filter(
      (p) => scoreItem({ id: p.id, name: p.name, brand: p.brand, category: p.categorySlug, tags: p.tags, sku: p.sku }, q) > 0,
    );
  }

  // faixa de preço e marcas calculadas ANTES do filtro de preço, para os filtros não sumirem
  const brandMap = new Map<string, Brand>();
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const p of items) {
    brandMap.set(p.brandSlug, { slug: p.brandSlug, name: p.brand });
    min = Math.min(min, p.retailPrice);
    max = Math.max(max, p.retailPrice);
  }
  if (!Number.isFinite(min)) min = 0;

  if (typeof query.minPrice === "number") items = items.filter((p) => p.retailPrice >= (query.minPrice as number));
  if (typeof query.maxPrice === "number") items = items.filter((p) => p.retailPrice <= (query.maxPrice as number));

  items = sortProducts(items, query.sort, query.search);

  const total = items.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 24;

  return {
    items: items.slice(offset, offset + limit),
    total,
    brands: Array.from(brandMap.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    priceRange: { min, max },
  };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const sb = createPublicClient();
  if (!sb) return mockCatalog.products.find((p) => p.slug === slug) ?? null;
  const { data, error } = await sb.from("products_public").select(PRODUCT_SELECT).eq("slug", slug).maybeSingle();
  if (error) {
    console.error("[catalog] falha ao carregar produto:", error.message);
    return mockCatalog.products.find((p) => p.slug === slug) ?? null;
  }
  return data ? mapProduct(data as unknown as ProductRow) : null;
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  const all = await loadAllProducts();
  const set = new Set(ids);
  return all.filter((p) => set.has(p.id));
}

export interface SiteSettings {
  avisoTopo: string;
  bestSellerIds: string[];
  bloqueio: { ativo: boolean; data: string | null; mensagem: string };
  frete: { freeShippingFromCentavos: number; flatCentavos: number; pickupEnabled: boolean };
  pixPct: number;
}

const DEFAULT_SITE_SETTINGS: SiteSettings = {
  avisoTopo: "",
  bestSellerIds: [],
  bloqueio: { ativo: false, data: null, mensagem: "" },
  frete: { freeShippingFromCentavos: 79900, flatCentavos: 4990, pickupEnabled: true },
  pixPct: 5,
};

/** Configurações editadas no admin (site_settings). Sem banco: padrões. */
export async function getSiteSettings(): Promise<SiteSettings> {
  const sb = createPublicClient();
  if (!sb) return DEFAULT_SITE_SETTINGS;
  const { data } = await sb.from("site_settings").select("key, value");
  const map = new Map((data ?? []).map((r) => [r.key as string, (r.value ?? {}) as Record<string, unknown>]));
  const frete = map.get("frete") ?? {};
  const bloqueio = map.get("entrega_bloqueio") ?? {};
  const descontos = map.get("descontos") ?? {};
  return {
    avisoTopo: String((map.get("avisos") ?? {}).topo ?? ""),
    bestSellerIds: ((map.get("best_sellers") ?? {}).ids as string[]) ?? [],
    bloqueio: { ativo: bloqueio.ativo === true, data: (bloqueio.data as string) ?? null, mensagem: String(bloqueio.mensagem ?? "") },
    frete: {
      freeShippingFromCentavos: Number(frete.freeShippingFromCentavos ?? 79900),
      flatCentavos: Number(frete.flatCentavos ?? 4990),
      pickupEnabled: frete.pickupEnabled !== false,
    },
    pixPct: Number(descontos.pixPct ?? 5),
  };
}

/** Vitrines da home: "ofertas", "mais vendidos", "atacado", "novidades", por categoria. */
export async function getShowcase(kind: "ofertas" | "mais-vendidos" | "atacado" | "novidades" | { category: string }, limit = 10): Promise<Product[]> {
  const all = await loadAllProducts();
  let items: Product[];
  if (typeof kind === "object") items = all.filter((p) => p.categorySlug === kind.category);
  else if (kind === "ofertas") items = all.filter((p) => offerDiscountPct(p) > 0 || p.badges?.includes("oferta"));
  else if (kind === "mais-vendidos") {
    // lista curada no admin (Conteúdo do site) tem prioridade sobre o selo
    const ids = (await getSiteSettings()).bestSellerIds;
    if (ids.length) {
      const byId = new Map(all.map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p)).slice(0, limit);
    }
    items = all.filter((p) => p.badges?.includes("mais-vendido"));
  }
  else if (kind === "atacado") items = all.filter((p) => hasWholesale(p) && (p.badges?.includes("atacado") || (p.wholesaleMinQty ?? 0) >= 10));
  else items = all.filter((p) => p.badges?.includes("novo") || p.badges?.includes("lancamento"));
  return sortProducts(items, "relevance").slice(0, limit);
}

/** Produtos relacionados: mesma subcategoria, depois mesma categoria. */
export async function getRelatedProducts(product: Product, limit = 8): Promise<Product[]> {
  const all = await loadAllProducts();
  const same = all.filter((p) => p.id !== product.id && p.subcategorySlug && p.subcategorySlug === product.subcategorySlug);
  const cat = all.filter((p) => p.id !== product.id && p.categorySlug === product.categorySlug && !same.includes(p));
  return [...same, ...cat].slice(0, limit);
}

/** Sugestões para o autocomplete da busca (nomes + categorias). */
export async function getSearchSuggestions(term: string, limit = 8): Promise<{ products: Product[]; categories: Category[] }> {
  const [all, cats] = await Promise.all([loadAllProducts(), getCategories()]);
  const q = normalize(term);
  if (!q) return { products: [], categories: [] };
  const products = all
    .map((p) => ({ p, s: scoreItem({ id: p.id, name: p.name, brand: p.brand, category: p.categorySlug, tags: p.tags, sku: p.sku }, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
  const categories = cats.filter((c) => normalize(c.name).includes(q) || c.children.some((s) => normalize(s.name).includes(q))).slice(0, 3);
  return { products, categories };
}
