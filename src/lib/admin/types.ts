/** Linhas do banco usadas pelo painel admin (colunas como no Postgres). */

export interface AdminProduct {
  id: string;
  slug: string;
  sku: string;
  ean: string | null;
  name: string;
  brand_slug: string | null;
  brand_name: string;
  category_slug: string;
  subcategory_slug: string | null;
  supplier_id: string | null;
  unit: string;
  pack_info: string | null;
  retail_price: number;
  wholesale_price: number | null;
  wholesale_min_qty: number | null;
  list_price: number | null;
  pix_discount_pct: number | null;
  images: string[];
  image_source: string | null;
  image_manual: boolean;
  image_pending: boolean;
  image_pending_reason: string | null;
  rating: number | null;
  review_count: number;
  badges: string[];
  short_description: string;
  description: string | null;
  specs: { label: string; value: string }[];
  stock: number | null;
  max_per_order: number | null;
  max_per_order_enabled: boolean;
  stock_status: "in_stock" | "supplier" | "out";
  tags: string[];
  yield_hint: string | null;
  sort: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const ADMIN_PRODUCT_COLUMNS =
  "id, slug, sku, ean, name, brand_slug, brand_name, category_slug, subcategory_slug, supplier_id, unit, pack_info, retail_price, wholesale_price, wholesale_min_qty, list_price, pix_discount_pct, images, image_source, image_manual, image_pending, image_pending_reason, rating, review_count, badges, short_description, description, specs, stock, max_per_order, max_per_order_enabled, stock_status, tags, yield_hint, sort, active, created_at, updated_at";

export interface AdminCategory {
  slug: string;
  name: string;
  icon: string;
  description: string;
  image: string | null;
  tone: string | null;
  sort: number;
  active: boolean;
  subcategories: { slug: string; name: string; sort: number }[];
}

export interface AdminBrand {
  slug: string;
  name: string;
  logo: string | null;
}

export interface AdminSupplier {
  id: string;
  name: string;
  lead_time_days: number;
  city: string | null;
  cnpj: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  active: boolean;
  created_at: string;
  trade_name: string | null;
  state: string | null;
  pedido_minimo_tipo: "valor" | "volume" | null;
  pedido_minimo_centavos: number | null;
  dias_pedido: number[] | null;
  frete_tipo: "gratis_acima" | "fixo" | null;
  frete_gratis_acima_centavos: number | null;
  frete_valor_centavos: number | null;
}

export type SaleMode = "por_unidade" | "embalagem_fechada" | "unidade_e_caixa" | "nao_vender";
export type UnidadeCompra = "unidade" | "caixa" | "fardo" | "rolo";

export interface AccessRequest {
  id: string;
  supplier_id: string;
  supplier_name: string;
  profile_id: string;
  profile_name: string | null;
  profile_email: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
}

export interface LinkedProfile {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export interface AdminBanner {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  cta: string;
  href: string;
  image: string;
  theme: "navy" | "yellow" | "orange" | "dark";
  variant: "photo" | "mascot";
  sort: number;
  active: boolean;
  campaign_id: string | null;
}

export interface CampaignProduct {
  product_id: string;
  name: string;
  price: number;
  original_price?: number | null;
  original_list_price?: number | null;
}

export interface AdminCampaign {
  id: string;
  title: string;
  starts_at: string;
  status: "agendada" | "ativa" | "pulada" | "cancelada" | "encerrada";
  products: CampaignProduct[];
  banners: { image: string; sort: number }[];
  created_at: string;
  activated_at: string | null;
  ended_at: string | null;
}

export interface OrderEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  actor_kind: string;
  created_at: string;
}

export interface AdminLead {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  source: string;
  created_at: string;
}

export interface AdminProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  document: string | null;
  phone: string | null;
  role: "customer" | "admin";
  created_at: string;
}

export interface FreteSettings {
  freeShippingFromCentavos: number;
  flatCentavos: number;
  pickupEnabled: boolean;
}
export interface BloqueioSettings {
  ativo: boolean;
  data: string | null;
  mensagem?: string;
}
export interface DescontosSettings {
  pixPct: number;
  primeiraCompra: { ativo: boolean; percentual: number };
  secoes?: Record<string, number>;
}
export interface SiteSettings {
  frete: FreteSettings;
  entrega_bloqueio: BloqueioSettings;
  descontos: DescontosSettings;
  best_sellers: { ids: string[] };
  avisos: { topo: string };
}

export const DEFAULT_SETTINGS: SiteSettings = {
  frete: { freeShippingFromCentavos: 79900, flatCentavos: 4990, pickupEnabled: true },
  entrega_bloqueio: { ativo: false, data: null, mensagem: "" },
  descontos: { pixPct: 5, primeiraCompra: { ativo: false, percentual: 0 }, secoes: {} },
  best_sellers: { ids: [] },
  avisos: { topo: "" },
};
