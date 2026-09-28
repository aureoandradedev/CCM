/**
 * Tipos do catálogo do CCM (Central de Compras Multigiro).
 *
 * Modelo pensado para o diferencial do projeto: o CCM não tem estoque próprio,
 * cada produto pertence a um FORNECEDOR que fatura e entrega. A integração com
 * os fornecedores vem depois. Aqui já deixamos `supplier` e `stockStatus` para
 * o front não precisar mudar quando isso chegar.
 */

export type StockStatus = "in_stock" | "supplier" | "out";

export type ProductBadge =
  | "oferta"
  | "novo"
  | "mais-vendido"
  | "frete-gratis"
  | "atacado"
  | "lancamento";

export interface Supplier {
  id: string;
  name: string;
  /** prazo médio de despacho, em dias úteis */
  leadTimeDays: number;
  city?: string;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  brandSlug: string;
  categorySlug: string;
  subcategorySlug?: string;
  /** unidade de venda exibida no preço: "un", "m²", "saco", "lata", "cx", "m" */
  unit: string;
  /** descrição da embalagem: "Saco 50kg", "Caixa com 2,36 m²", "Lata 18L" */
  packInfo?: string;
  /** preço varejo por unidade de venda */
  retailPrice: number;
  /** preço atacado por unidade (opcional), vale a partir de `wholesaleMinQty` */
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  /** preço "de" riscado quando o produto está em oferta */
  listPrice?: number;
  /** desconto no Pix (%), quando existir */
  pixDiscountPct?: number;
  images: string[];
  rating?: number;
  reviewCount?: number;
  badges?: ProductBadge[];
  shortDescription: string;
  description?: string;
  specs?: ProductSpec[];
  supplier?: Supplier;
  stockStatus: StockStatus;
  tags?: string[];
  /** rendimento/consumo, ex.: "1 saco rende 0,5 m² de alvenaria" */
  yieldHint?: string;
}

export interface Subcategory {
  slug: string;
  name: string;
}

export type CategoryTone = "yellow" | "orange" | "navy" | "green" | "blue" | "red" | "slate";

export interface Category {
  slug: string;
  name: string;
  /** nome do ícone lucide-react (resolvido no componente) */
  icon: string;
  description: string;
  image?: string;
  children: Subcategory[];
  tone?: CategoryTone;
}

export interface Brand {
  slug: string;
  name: string;
}

export interface Banner {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  cta: string;
  href: string;
  image: string;
  theme: "navy" | "yellow" | "orange" | "dark";
  /** "photo" = foto cobrindo o lado direito; "mascot" = mascote recortado (PNG com alpha) */
  variant?: "photo" | "mascot";
}

export interface QuickLink {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface Inspiration {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  href: string;
}

export type SortOption = "relevance" | "price-asc" | "price-desc" | "name" | "newest";

export interface ProductQuery {
  category?: string;
  subcategory?: string;
  brand?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  onlyWholesale?: boolean;
  onlyOffers?: boolean;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}

export interface ProductQueryResult {
  items: Product[];
  total: number;
  /** marcas presentes no resultado sem paginação (para os filtros) */
  brands: Brand[];
  priceRange: { min: number; max: number };
}
