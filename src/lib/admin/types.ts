import { FREE_SHIPPING_FROM_CENTAVOS, STANDARD_SHIPPING_CENTAVOS } from "@/lib/shipping";

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
}

export interface SupplierCommercialTerms {
  id: string;
  supplier_id: string;
  pedido_minimo_tipo: "valor" | "volume";
  pedido_minimo: number;
  frete_tipo: "gratis_acima" | "fixo";
  frete_gratis_acima: number | null;
  frete_valor: number | null;
  dias_pedido: number[];
  prazo_entrega_cd_dias: number;
  cutoff_time: string | null;
  business_hours: Record<string, { open: string; close: string }> | null;
  lead_time_minutes: number | null;
  active: boolean;
  valid_from: string;
  valid_to: string | null;
}

export type SaleMode = "por_unidade" | "embalagem_fechada" | "unidade_e_caixa" | "nao_vender";
export type UnidadeCompra = "unidade" | "caixa" | "fardo" | "rolo";

export interface CcmConfig {
  id: string;
  key: string;
  scope: "global" | "section" | "product";
  scope_ref: string | null;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
}

export interface CcmConfigHistory {
  id: string;
  config_id: string;
  key: string;
  scope: string;
  scope_ref: string | null;
  old_value: unknown;
  new_value: unknown;
  changed_by: string;
  changed_at: string;
}

export interface InventorySummary {
  master_product_id: string;
  product_name: string;
  category_slug: string | null;
  quantity: number;
  unit_cost_centavos: number;
  total_value_centavos: number;
  ceiling_centavos: number | null;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  cycle_date: string;
  status: "draft" | "minimum_not_met" | "ready" | "sent" | "received" | "partial" | "confirmed" | "completed" | "cancelled";
  total_centavos: number;
  item_count: number;
  minimum_type: string | null;
  minimum_value: number | null;
  minimum_met: boolean;
  freight_centavos: number;
  decision: string | null;
  expected_delivery: string | null;
  created_at: string;
  supplier_confirmation_status?: string | null;
  supplier_confirmed_at?: string | null;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  master_product_id: string;
  product_name: string;
  quantity_units: number;
  quantity_packages: number;
  package_unit: string;
  qtd_por_embalagem: number;
  unit_cost_centavos: number;
  total_centavos: number;
  leftover_units: number;
}

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
  shipment_id: string | null;
  created_at: string;
}

export interface ShipmentOccurrenceRow {
  id: string;
  shipment_id: string;
  type: "attempt" | "delay" | "damage" | "return" | "note";
  description: string;
  occurred_at: string;
  logged_by: string | null;
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

export interface HolidayCalendarRow {
  id: string;
  scope: "national" | "state" | "municipal";
  state_code: string | null;
  city_name: string | null;
  holiday_date: string;
  name: string;
  recurring: boolean;
  created_at: string;
}

export interface ReceivingSessionRow {
  id: string;
  purchase_order_id: string;
  inspector_id: string | null;
  status: "in_progress" | "completed" | "cancelled";
  started_at: string;
  completed_at: string | null;
  allocation_confirmed_at: string | null;
  notes: string | null;
  created_at: string;
  supplier_purchase_orders?: {
    supplier_id: string;
    cycle_date: string;
    status: string;
    suppliers?: { name: string };
  };
}

export interface ReceivingItemRow {
  id: string;
  receiving_session_id: string;
  purchase_order_item_id: string;
  master_product_id: string;
  expected_qty: number;
  received_qty: number;
  accepted_qty: number;
  damaged_qty: number;
  is_swapped: boolean;
  swapped_product_id: string | null;
  photos: string[];
  notes: string | null;
  created_at: string;
  master_products?: { name: string; ean: string | null };
}

export interface OperationalExceptionRow {
  id: string;
  type: "shortage" | "damage" | "swap" | "excess" | "late_delivery" | "other";
  receiving_session_id: string | null;
  supplier_id: string | null;
  severity: "low" | "medium" | "high" | "critical";
  resolution_status: "open" | "investigating" | "resolved" | "accepted";
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  details: Record<string, unknown>;
  suppliers?: { name: string };
  exception_links?: ExceptionLinkRow[];
}

export interface ExceptionLinkRow {
  id: string;
  exception_id: string;
  link_type: "order" | "shipment" | "product" | "purchase_order";
  order_id: string | null;
  shipment_id: string | null;
  product_id: string | null;
  purchase_order_id: string | null;
}

export type FiscalStatus = "pending" | "sending" | "created" | "invoiced" | "cancelled" | "error";

export interface FiscalDocumentRow {
  id: string;
  order_id: string;
  shipment_id: string | null;
  provider: string;
  provider_reference: string | null;
  codigo_ecommerce: string;
  status: FiscalStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  invoiced_at: string | null;
  cancelled_at: string | null;
}

export interface SupplierPromotionRow {
  id: string;
  supplier_id: string;
  discount_pct: number;
  min_margin_pct: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  frete: { freeShippingFromCentavos: FREE_SHIPPING_FROM_CENTAVOS, flatCentavos: STANDARD_SHIPPING_CENTAVOS, pickupEnabled: true },
  entrega_bloqueio: { ativo: false, data: null, mensagem: "" },
  descontos: { pixPct: 5, primeiraCompra: { ativo: false, percentual: 0 }, secoes: {} },
  best_sellers: { ids: [] },
  avisos: { topo: "" },
};
