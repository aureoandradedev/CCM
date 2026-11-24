import { ORDER_COLUMNS, type OrderItemRow, type OrderRow, type OrderShipmentRow } from "@/lib/orders";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

import {
  ADMIN_PRODUCT_COLUMNS,
  DEFAULT_SETTINGS,
  type AdminBanner,
  type AdminBrand,
  type AdminCampaign,
  type AdminCategory,
  type AdminLead,
  type AdminProduct,
  type AccessRequest,
  type AdminProfile,
  type AdminSupplier,
  type CcmConfig,
  type CcmConfigHistory,
  type FiscalDocumentRow,
  type HolidayCalendarRow,
  type InventorySummary,
  type LinkedProfile,
  type OperationalExceptionRow,
  type OrderEvent,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type ReceivingSessionRow,
  type ShipmentOccurrenceRow,
  type SiteSettings,
  type SupplierPromotionRow,
} from "./types";

/**
 * Leituras do painel admin. Usa a sessão do admin logado (RLS: `is_admin()`
 * libera tudo), nunca a service role.
 */

const TZ = "America/Sao_Paulo";

/** "YYYY-MM-DD" de hoje em São Paulo. */
export function todaySP(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Intervalo UTC [início, fim) de um dia "YYYY-MM-DD" em São Paulo (UTC-3, sem horário de verão desde 2019). */
export function dayRangeSP(day: string): { from: string; to: string } {
  const from = new Date(`${day}T00:00:00-03:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export const configured = () => isSupabaseConfigured();

/* --------------------------------- produtos -------------------------------- */

export interface ProductFilters {
  q?: string;
  category?: string;
  supplier?: string;
  foto?: "sem" | "pendente";
  status?: "ativos" | "inativos" | "todos";
  oferta?: boolean;
  page?: number;
  perPage?: number;
}

export async function adminListProducts(f: ProductFilters = {}): Promise<{ items: AdminProduct[]; total: number }> {
  if (!configured()) return { items: [], total: 0 };
  const sb = await createClient();
  const perPage = f.perPage ?? 40;
  const page = Math.max(1, f.page ?? 1);
  let q = sb.from("products").select(ADMIN_PRODUCT_COLUMNS, { count: "exact" });
  if (f.status === "inativos") q = q.eq("active", false);
  else if (f.status !== "todos") q = q.eq("active", true);
  if (f.category) q = q.eq("category_slug", f.category);
  if (f.supplier) q = q.eq("supplier_id", f.supplier);
  if (f.oferta) q = q.not("list_price", "is", null);
  if (f.foto === "pendente") q = q.eq("image_pending", true);
  if (f.foto === "sem") q = q.or('images.eq.{},images.cs.{"https://images.unsplash.com"}');
  if (f.q) {
    const term = f.q.trim();
    // nome/sku/marca: ilike simples é suficiente para o admin
    q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand_name.ilike.%${term}%,ean.ilike.%${term}%`);
  }
  const { data, count } = await q.order("updated_at", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
  return { items: (data as unknown as AdminProduct[] | null) ?? [], total: count ?? 0 };
}

export async function adminGetProduct(id: string): Promise<AdminProduct | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data } = await sb.from("products").select(ADMIN_PRODUCT_COLUMNS).eq("id", id).maybeSingle();
  return (data as unknown as AdminProduct | null) ?? null;
}

/** Todos os produtos ativos em forma leve (matcher de ofertas, mais vendidos, campanhas). */
export async function adminProductIndex(): Promise<{ id: string; name: string; sku: string; brand_name: string; category_slug: string; retail_price: number; list_price: number | null; images: string[]; tags: string[] }[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("products").select("id, name, sku, brand_name, category_slug, retail_price, list_price, images, tags").eq("active", true).order("name").limit(5000);
  return (data ?? []).map((p) => ({ ...p, retail_price: Number(p.retail_price), list_price: p.list_price === null ? null : Number(p.list_price) }));
}

export async function adminCategories(): Promise<AdminCategory[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("categories").select("slug, name, icon, description, image, tone, sort, active, subcategories(slug, name, sort)").order("sort");
  return ((data as unknown as AdminCategory[] | null) ?? []).map((c) => ({ ...c, subcategories: (c.subcategories ?? []).slice().sort((a, b) => a.sort - b.sort) }));
}

export async function adminBrands(): Promise<AdminBrand[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("brands").select("slug, name, logo").order("name");
  return (data as AdminBrand[] | null) ?? [];
}

const SUPPLIER_COLUMNS = "id, name, lead_time_days, city, cnpj, contact_name, contact_email, contact_phone, active, created_at, trade_name, state";

export async function adminSuppliers(): Promise<AdminSupplier[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("suppliers").select(SUPPLIER_COLUMNS).order("name");
  return (data as AdminSupplier[] | null) ?? [];
}

export async function adminSupplierById(id: string): Promise<AdminSupplier | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data } = await sb.from("suppliers").select(SUPPLIER_COLUMNS).eq("id", id).single();
  return (data as AdminSupplier | null) ?? null;
}

export async function adminLinkedProfiles(supplierId: string): Promise<LinkedProfile[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("supplier_id", supplierId)
    .order("full_name");
  return (data as LinkedProfile[] | null) ?? [];
}

/* ----------------------------- condições comerciais ----------------------- */

export async function adminSupplierCommercialTerms(supplierId: string): Promise<import("./types").SupplierCommercialTerms | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_commercial_terms")
    .select("id, supplier_id, pedido_minimo_tipo, pedido_minimo, frete_tipo, frete_gratis_acima, frete_valor, dias_pedido, prazo_entrega_cd_dias, cutoff_time, business_hours, lead_time_minutes, active, valid_from, valid_to")
    .eq("supplier_id", supplierId)
    .eq("active", true)
    .is("valid_to", null)
    .single();
  return (data as import("./types").SupplierCommercialTerms | null) ?? null;
}

export interface SupplierCatalogSummary {
  id: string;
  source: string;
  source_name: string | null;
  status: string;
  total_items: number;
  processed: number;
  errors: number;
  created_at: string;
}

export async function adminSupplierCatalogs(supplierId: string): Promise<SupplierCatalogSummary[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_catalogs")
    .select("id, source, source_name, status, total_items, processed, errors, created_at")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as SupplierCatalogSummary[];
}

export async function adminSuppliersWithActiveTerms(): Promise<Set<string>> {
  if (!configured()) return new Set();
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_commercial_terms")
    .select("supplier_id")
    .eq("active", true)
    .is("valid_to", null);
  return new Set((data ?? []).map((r) => r.supplier_id as string));
}

/* ----------------------------- solicitações de acesso ----------------------- */

export async function adminAccessRequests(statusFilter: "pending" | "all" = "pending"): Promise<AccessRequest[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let q = sb
    .from("supplier_access_requests")
    .select("id, supplier_id, profile_id, status, note, requested_at, reviewed_at, suppliers(name), profiles(full_name, email)")
    .order("requested_at", { ascending: false })
    .limit(200);
  if (statusFilter === "pending") q = q.eq("status", "pending");
  const { data } = await q;
  return (data ?? []).map((r) => {
    const sup = r.suppliers as unknown as Record<string, unknown> | null;
    const prof = r.profiles as unknown as Record<string, unknown> | null;
    return {
      id: r.id as string,
      supplier_id: r.supplier_id as string,
      supplier_name: (sup?.name as string) ?? (r.supplier_id as string),
      profile_id: r.profile_id as string,
      profile_name: (prof?.full_name as string | null) ?? null,
      profile_email: (prof?.email as string) ?? "",
      status: r.status as AccessRequest["status"],
      note: r.note as string | null,
      requested_at: r.requested_at as string,
      reviewed_at: r.reviewed_at as string | null,
    };
  });
}

export async function adminPendingRequestCount(): Promise<number> {
  if (!configured()) return 0;
  const sb = await createClient();
  const { count } = await sb
    .from("supplier_access_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/* -------------------------------- integrações ------------------------------ */

export interface AdminIntegration {
  id: string;
  supplier_id: string;
  supplier_name: string;
  method: string;
  connector_id: string | null;
  status: string;
  sync_mode: string;
  product_count: number;
  valid_count: number;
  error_count: number;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

export async function adminIntegrations(): Promise<AdminIntegration[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_integrations")
    .select("*, suppliers(name)")
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    supplier_id: r.supplier_id as string,
    supplier_name: ((r.suppliers as Record<string, unknown>)?.name as string) ?? (r.supplier_id as string),
    method: r.method as string,
    connector_id: r.connector_id as string | null,
    status: r.status as string,
    sync_mode: (r.sync_mode as string) ?? "full",
    product_count: r.product_count as number,
    valid_count: r.valid_count as number,
    error_count: r.error_count as number,
    last_sync_at: r.last_sync_at as string | null,
    last_error: (r.last_error as string | null) ?? null,
    created_at: r.created_at as string,
  }));
}

export interface AdminBatch {
  id: string;
  supplier_id: string;
  integration_id: string | null;
  method: string;
  source_name: string | null;
  total: number;
  valid: number;
  invalid: number;
  items_created: number;
  items_updated: number;
  items_ignored: number;
  error_count: number;
  status: string;
  sync_type: string;
  created_at: string;
  finished_at: string | null;
}

export async function adminBatches(integrationId?: string, limit = 20): Promise<AdminBatch[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let q = sb
    .from("integration_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (integrationId) q = q.eq("integration_id", integrationId);
  const { data } = await q;
  return (data ?? []) as AdminBatch[];
}

/* ---------------------------------- pedidos -------------------------------- */

export interface OrderFilters {
  status?: string; // aba
  q?: string;
  de?: string; // YYYY-MM-DD
  ate?: string;
  pagamento?: string; // payment_method
  page?: number;
  perPage?: number;
}

export async function adminListOrders(f: OrderFilters = {}): Promise<{ items: OrderRow[]; total: number }> {
  if (!configured()) return { items: [], total: 0 };
  const sb = await createClient();
  const perPage = f.perPage ?? 50;
  const page = Math.max(1, f.page ?? 1);
  let q = sb.from("orders").select(ORDER_COLUMNS, { count: "exact" });
  if (f.status && f.status !== "todos") q = q.eq("order_status", f.status);
  if (f.pagamento) q = q.eq("payment_method", f.pagamento);
  if (f.de) q = q.gte("created_at", dayRangeSP(f.de).from);
  if (f.ate) q = q.lt("created_at", dayRangeSP(f.ate).to);
  if (f.q) {
    const t = f.q.trim();
    const dig = t.replace(/\D+/g, "");
    const parts = [`code.ilike.%${t}%`, `customer->>name.ilike.%${t}%`, `customer->>email.ilike.%${t}%`];
    if (dig) parts.push(`customer->>document.ilike.%${dig}%`, `customer->>phone.ilike.%${dig}%`);
    q = q.or(parts.join(","));
  }
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * perPage, page * perPage - 1);
  return { items: (data as OrderRow[] | null) ?? [], total: count ?? 0 };
}

export async function adminOrdersAwaitingConfirmation(): Promise<OrderRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("order_status", "aguardando-confirmacao")
    .order("created_at", { ascending: true });
  return (data as OrderRow[] | null) ?? [];
}

export async function adminOrderWithItemsForConfirmation(
  orderId: string,
): Promise<{ order: OrderRow; items: OrderItemRow[] } | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data: order } = await sb
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .eq("order_status", "aguardando-confirmacao")
    .maybeSingle();
  if (!order) return null;
  const { data: items } = await sb
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("name");
  return {
    order: order as OrderRow,
    items: (items as OrderItemRow[] | null) ?? [],
  };
}

export async function adminOrderCounts(): Promise<Record<string, number>> {
  if (!configured()) return {};
  const sb = await createClient();
  const { data } = await sb.from("orders").select("order_status").limit(5000);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.order_status] = (out[r.order_status] ?? 0) + 1;
  return out;
}

export async function adminGetOrder(code: string): Promise<{ order: OrderRow; items: OrderItemRow[]; events: OrderEvent[]; shipments: OrderShipmentRow[]; occurrences: ShipmentOccurrenceRow[]; fiscalDocs: FiscalDocumentRow[] } | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data: order } = await sb.from("orders").select(ORDER_COLUMNS).eq("code", code.toUpperCase()).maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: events }, { data: shipments }, { data: fiscalDocs }] = await Promise.all([
    sb.from("order_items").select("*").eq("order_id", order.id).order("name"),
    sb.from("order_events").select("id, type, data, actor_kind, shipment_id, created_at").eq("order_id", order.id).order("created_at", { ascending: false }),
    sb.from("order_shipments").select("*").eq("order_id", order.id).order("sequence"),
    sb.from("fiscal_documents").select("id, order_id, shipment_id, provider, provider_reference, codigo_ecommerce, status, attempt_count, last_error, created_at, updated_at, sent_at, invoiced_at, cancelled_at").eq("order_id", order.id).order("created_at", { ascending: false }),
  ]);
  const shipmentIds = (shipments ?? []).map((s: { id: string }) => s.id);
  const { data: occurrences } = shipmentIds.length
    ? await sb.from("shipment_occurrences").select("*").in("shipment_id", shipmentIds).order("occurred_at", { ascending: false })
    : { data: [] };
  return {
    order: order as OrderRow,
    items: (items as OrderItemRow[] | null) ?? [],
    events: (events as OrderEvent[] | null) ?? [],
    shipments: (shipments as OrderShipmentRow[] | null) ?? [],
    occurrences: (occurrences as ShipmentOccurrenceRow[] | null) ?? [],
    fiscalDocs: (fiscalDocs as FiscalDocumentRow[] | null) ?? [],
  };
}

/* ----------------------------------- caixa --------------------------------- */

export interface CashSummary {
  day: string;
  orders: OrderRow[];
  vendido: number;
  recebido: number;
  falta: number;
  desconsiderados: number;
  porMetodo: { metodo: string; qtd: number; total: number; recebido: number }[];
  duplicados: OrderRow[][];
}

export async function adminCash(day: string): Promise<CashSummary> {
  const empty: CashSummary = { day, orders: [], vendido: 0, recebido: 0, falta: 0, desconsiderados: 0, porMetodo: [], duplicados: [] };
  if (!configured()) return empty;
  const sb = await createClient();
  const { from, to } = dayRangeSP(day);
  const { data } = await sb.from("orders").select(ORDER_COLUMNS).gte("created_at", from).lt("created_at", to).neq("order_status", "cancelado").order("created_at");
  const orders = (data as OrderRow[] | null) ?? [];
  const s = { ...empty, orders };
  const metodo = new Map<string, { qtd: number; total: number; recebido: number }>();
  for (const o of orders) {
    if (o.revenue_excluded) {
      s.desconsiderados += o.total_centavos;
      continue;
    }
    s.vendido += o.total_centavos;
    if (o.payment_status === "pago") s.recebido += o.total_centavos;
    else if (o.payment_status === "pendente") s.falta += o.total_centavos;
    const mKey = o.payment_method ?? "a-definir";
    const m = metodo.get(mKey) ?? { qtd: 0, total: 0, recebido: 0 };
    m.qtd += 1;
    m.total += o.total_centavos;
    if (o.payment_status === "pago") m.recebido += o.total_centavos;
    metodo.set(mKey, m);
  }
  s.porMetodo = [...metodo.entries()].map(([metodo, v]) => ({ metodo, ...v })).sort((a, b) => b.total - a.total);
  // duplicados: mesmo CPF + mesmo total em até 30 min
  const byKey = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const k = `${o.customer?.document}|${o.total_centavos}`;
    byKey.set(k, [...(byKey.get(k) ?? []), o]);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const grupo: OrderRow[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      if (new Date(list[i].created_at).getTime() - new Date(list[i - 1].created_at).getTime() <= 30 * 60 * 1000) grupo.push(list[i]);
    }
    if (grupo.length > 1) s.duplicados.push(grupo);
  }
  return s;
}

/* ------------------------------------ BI ----------------------------------- */

export interface DailyRevenue {
  dia: string;
  pedidos_pagos: number;
  pedidos: number;
  faturamento_centavos: number;
  vendido_centavos: number;
}

export async function adminDailyRevenue(year: number, month?: number): Promise<DailyRevenue[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const from = month ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-01-01`;
  const to = month ? (month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`) : `${year + 1}-01-01`;
  const { data } = await sb.from("v_faturamento_diario").select("*").gte("dia", from).lt("dia", to).order("dia");
  return ((data as DailyRevenue[] | null) ?? []).map((d) => ({ ...d, pedidos_pagos: Number(d.pedidos_pagos), pedidos: Number(d.pedidos), faturamento_centavos: Number(d.faturamento_centavos), vendido_centavos: Number(d.vendido_centavos) }));
}

export async function adminRevenueExcluded(limit = 100): Promise<OrderRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("orders").select(ORDER_COLUMNS).eq("revenue_excluded", true).order("created_at", { ascending: false }).limit(limit);
  return (data as OrderRow[] | null) ?? [];
}

/** Painel inicial: pedidos de hoje, mês, pendências. */
export async function adminDashboard() {
  const today = todaySP();
  const [hoje, mes, counts, ultimos, campanhas] = await Promise.all([
    adminCash(today),
    adminDailyRevenue(Number(today.slice(0, 4)), Number(today.slice(5, 7))),
    adminOrderCounts(),
    adminListOrders({ perPage: 8 }),
    adminCampaigns(),
  ]);
  const mesFaturamento = mes.reduce((a, d) => a + d.faturamento_centavos, 0);
  const mesPedidos = mes.reduce((a, d) => a + d.pedidos_pagos, 0);
  const atrasadas = campanhas.filter(campanhaAtrasada);
  return { today, hoje, mesFaturamento, mesPedidos, counts, ultimos: ultimos.items, campanhasAtrasadas: atrasadas };
}

/* ------------------------------- clientes/leads ---------------------------- */

export interface CustomerSummary {
  document: string;
  name: string;
  phone: string;
  email: string;
  pedidos: number;
  total: number;
  ultimo: string;
  cadastrado: boolean;
}

export async function adminCustomers(): Promise<{ customers: CustomerSummary[]; leads: AdminLead[]; profiles: AdminProfile[] }> {
  if (!configured()) return { customers: [], leads: [], profiles: [] };
  const sb = await createClient();
  const [{ data: orders }, { data: leads }, { data: profiles }] = await Promise.all([
    sb.from("orders").select("customer, total_centavos, created_at, payment_status, revenue_excluded, profile_id").neq("order_status", "cancelado").order("created_at", { ascending: false }).limit(5000),
    sb.from("leads").select("id, phone, email, name, source, created_at").order("created_at", { ascending: false }).limit(500),
    sb.from("profiles").select("id, full_name, email, document, phone, role, created_at").order("created_at", { ascending: false }).limit(2000),
  ]);
  const map = new Map<string, CustomerSummary>();
  for (const o of orders ?? []) {
    const c = o.customer as OrderRow["customer"];
    const doc = c?.document ?? "";
    const cur = map.get(doc) ?? { document: doc, name: c?.name ?? "", phone: c?.phone ?? "", email: c?.email ?? "", pedidos: 0, total: 0, ultimo: o.created_at, cadastrado: Boolean(o.profile_id) };
    cur.pedidos += 1;
    if (o.payment_status === "pago" && !o.revenue_excluded) cur.total += o.total_centavos;
    if (o.profile_id) cur.cadastrado = true;
    map.set(doc, cur);
  }
  return { customers: [...map.values()].sort((a, b) => b.total - a.total), leads: (leads as AdminLead[] | null) ?? [], profiles: (profiles as AdminProfile[] | null) ?? [] };
}

/* ----------------------------- conteúdo / settings ------------------------- */

export async function adminSettings(): Promise<SiteSettings> {
  if (!configured()) return DEFAULT_SETTINGS;
  const sb = await createClient();
  const { data } = await sb.from("site_settings").select("key, value");
  const out = structuredClone(DEFAULT_SETTINGS) as SiteSettings & Record<string, unknown>;
  for (const r of data ?? []) {
    const k = r.key as keyof SiteSettings;
    if (k in out && r.value && typeof r.value === "object") out[k] = { ...(out[k] as object), ...(r.value as object) } as never;
  }
  return out;
}

export async function adminBanners(): Promise<AdminBanner[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("banners").select("id, eyebrow, title, subtitle, cta, href, image, theme, variant, sort, active, campaign_id").order("sort");
  return (data as AdminBanner[] | null) ?? [];
}

export async function adminCampaigns(): Promise<AdminCampaign[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("campaigns").select("id, title, starts_at, status, products, banners, created_at, activated_at, ended_at").order("starts_at", { ascending: false }).limit(200);
  return (data as AdminCampaign[] | null) ?? [];
}

export async function adminGetCampaign(id: string): Promise<AdminCampaign | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data } = await sb.from("campaigns").select("id, title, starts_at, status, products, banners, created_at, activated_at, ended_at").eq("id", id).maybeSingle();
  return (data as AdminCampaign | null) ?? null;
}

export async function adminAdmins(): Promise<AdminProfile[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("profiles").select("id, full_name, email, document, phone, role, created_at").eq("role", "admin").order("created_at");
  return (data as AdminProfile[] | null) ?? [];
}

/** Id novo de produto (fora do render por causa do React Compiler). */
export function newProductId(): string {
  return `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Campanha agendada cujo horário já passou e ainda não foi ativada. */
export function campanhaAtrasada(c: AdminCampaign): boolean {
  return c.status === "agendada" && new Date(c.starts_at).getTime() <= Date.now();
}

/* ------------------------------- configs CCM (Fase 10+) ---------------------- */

export async function adminConfigs(key?: string): Promise<CcmConfig[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let q = sb.from("ccm_configs").select("id, key, scope, scope_ref, value, updated_by, updated_at");
  if (key) q = q.eq("key", key);
  const { data } = await q.order("key").order("scope");
  return (data as CcmConfig[] | null) ?? [];
}

export async function adminConfigHistory(configId: string): Promise<CcmConfigHistory[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("ccm_config_history")
    .select("id, config_id, key, scope, scope_ref, old_value, new_value, changed_by, changed_at")
    .eq("config_id", configId)
    .order("changed_at", { ascending: false })
    .limit(50);
  return (data as CcmConfigHistory[] | null) ?? [];
}

export async function adminAutoPromoteEnabled(supplierId: string): Promise<boolean> {
  if (!configured()) return false;
  const sb = await createClient();
  const { data } = await sb
    .from("ccm_configs")
    .select("value")
    .eq("key", "auto_promote")
    .eq("scope", `supplier:${supplierId}`)
    .limit(1)
    .single();
  if (!data) return false;
  return data.value === true || data.value === "true";
}

/* ------------------------------- estoque CCM (Fase 13) ----------------------- */

export async function adminInventorySummary(): Promise<InventorySummary[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("v_leftover_summary")
    .select("master_product_id, product_name, category_slug, quantity, unit_cost_centavos, total_value_centavos, ceiling_centavos");
  return (data as InventorySummary[] | null) ?? [];
}

export async function adminInventoryTotal(): Promise<{ total_value_centavos: number; ceiling_centavos: number | null }> {
  const items = await adminInventorySummary();
  const total = items.reduce((sum, i) => sum + i.total_value_centavos, 0);
  const ceiling = items[0]?.ceiling_centavos ?? null;
  return { total_value_centavos: total, ceiling_centavos: ceiling };
}

/* ------------------------------- pedidos de compra (Fase 14) ----------------- */

export async function consolidateTodayPurchaseOrders(): Promise<void> {
  if (!configured()) return;
  const sb = await createClient();
  const spDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  await sb.rpc("consolidate_cycle_purchase_orders", { p_cycle_date: spDate });
}

export async function adminPurchaseOrders(opts: { supplier_id?: string; status?: string; limit?: number } = {}): Promise<PurchaseOrder[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let q = sb.from("supplier_purchase_orders")
    .select("id, supplier_id, cycle_date, status, total_centavos, item_count, minimum_type, minimum_value, minimum_met, freight_centavos, decision, expected_delivery, created_at, supplier_confirmation_status, supplier_confirmed_at");
  if (opts.supplier_id) q = q.eq("supplier_id", opts.supplier_id);
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q.order("cycle_date", { ascending: false }).limit(opts.limit ?? 50);
  return (data as PurchaseOrder[] | null) ?? [];
}

export async function adminPurchaseOrderItems(poId: string): Promise<PurchaseOrderItem[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("purchase_order_items")
    .select("id, purchase_order_id, master_product_id, product_name, quantity_units, quantity_packages, package_unit, qtd_por_embalagem, unit_cost_centavos, total_centavos, leftover_units")
    .eq("purchase_order_id", poId)
    .order("product_name");
  return (data as PurchaseOrderItem[] | null) ?? [];
}

/* ------ R4.1: cutoff config + R4.2: holidays config (Etapa 1) ------------- */

export async function readCutoffConfig(): Promise<{ cutoffTime: string; holidays: string[] }> {
  if (!configured()) return { cutoffTime: "17:30", holidays: [] };
  const sb = await createClient();

  const [cutoffRes, holidaysRes] = await Promise.all([
    sb.from("ccm_configs").select("value")
      .eq("key", "horario_corte_ciclo").eq("scope", "global").limit(1).single(),
    sb.from("ccm_configs").select("value")
      .eq("key", "feriados").eq("scope", "global").limit(1).single(),
  ]);

  const cutoffTime = typeof cutoffRes.data?.value === "string"
    ? cutoffRes.data.value
    : "17:30";

  const holidays: string[] = Array.isArray(holidaysRes.data?.value)
    ? (holidaysRes.data.value as string[])
    : [];

  return { cutoffTime, holidays };
}

export function isAfterCutoff(cutoffTime: string): boolean {
  const now = new Date();
  const brTime = now.toLocaleTimeString("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return brTime >= cutoffTime;
}

/* ------ Bloco 1: Holiday Calendars + CD Config ----------------------------- */

export async function readHolidayCalendars(): Promise<HolidayCalendarRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb.from("holiday_calendars")
    .select("id, scope, state_code, city_name, holiday_date, name, recurring, created_at")
    .order("holiday_date", { ascending: true });
  return (data as HolidayCalendarRow[] | null) ?? [];
}

export async function readCdConfig(): Promise<{ city: string | null; state: string | null; address: string | null; hours: string | null }> {
  if (!configured()) return { city: null, state: null, address: null, hours: null };
  const sb = await createClient();
  const [cityRes, stateRes, addressRes, hoursRes] = await Promise.all([
    sb.from("ccm_configs").select("value")
      .eq("key", "cd_city").eq("scope", "global").limit(1).single(),
    sb.from("ccm_configs").select("value")
      .eq("key", "cd_state").eq("scope", "global").limit(1).single(),
    sb.from("ccm_configs").select("value")
      .eq("key", "cd_address").eq("scope", "global").limit(1).single(),
    sb.from("ccm_configs").select("value")
      .eq("key", "cd_hours").eq("scope", "global").limit(1).single(),
  ]);
  const city = cityRes.data?.value;
  const state = stateRes.data?.value;
  const address = addressRes.data?.value;
  const hours = hoursRes.data?.value;
  return {
    city: typeof city === "string" ? city : null,
    state: typeof state === "string" ? state : null,
    address: typeof address === "string" ? address : null,
    hours: typeof hours === "string" ? hours : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Receiving + Exceptions
// ═══════════════════════════════════════════════════════════════════════════

export async function readReceivingSessions(): Promise<ReceivingSessionRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("receiving_sessions")
    .select("*, supplier_purchase_orders(supplier_id, cycle_date, status, suppliers(name))")
    .order("started_at", { ascending: false })
    .limit(50);
  return (data as ReceivingSessionRow[] | null) ?? [];
}

export async function readReceivingSession(id: string): Promise<ReceivingSessionRow | null> {
  if (!configured()) return null;
  const sb = await createClient();
  const { data } = await sb
    .from("receiving_sessions")
    .select("*, supplier_purchase_orders(supplier_id, cycle_date, status, suppliers(name))")
    .eq("id", id)
    .maybeSingle();
  return data as ReceivingSessionRow | null;
}

export async function readPendingAllocations(): Promise<ReceivingSessionRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("receiving_sessions")
    .select("*, supplier_purchase_orders(supplier_id, cycle_date, status, suppliers(name))")
    .eq("status", "completed")
    .is("allocation_confirmed_at", null)
    .order("completed_at", { ascending: false });
  return (data as ReceivingSessionRow[] | null) ?? [];
}

export async function readReceivingItems(sessionId: string) {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("receiving_items")
    .select("*, master_products(name)")
    .eq("receiving_session_id", sessionId);
  return data ?? [];
}

export async function readPendingPurchaseOrders() {
  if (!configured()) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("supplier_purchase_orders")
    .select("id, supplier_id, cycle_date, status, item_count, total_centavos, suppliers(name)")
    .in("status", ["sent", "ready"])
    .order("cycle_date", { ascending: false });
  return data ?? [];
}

export async function readOperationalExceptions(status?: string): Promise<OperationalExceptionRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let query = sb
    .from("operational_exceptions")
    .select("*, suppliers(name), exception_links(*)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("resolution_status", status);
  const { data } = await query;
  return (data as OperationalExceptionRow[] | null) ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════
// Supplier Promotions
// ═══════════════════════════════════════════════════════════════════════════

export async function readSupplierPromotions(supplierId?: string): Promise<SupplierPromotionRow[]> {
  if (!configured()) return [];
  const sb = await createClient();
  let query = sb.from("supplier_promotions").select("*").order("created_at", { ascending: false });
  if (supplierId) query = query.eq("supplier_id", supplierId);
  const { data } = await query;
  return (data as SupplierPromotionRow[] | null) ?? [];
}
