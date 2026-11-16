/**
 * Data layer for Supplier BI — /admin/fornecedores/[id].
 *
 * All sales attribution uses order_items.supplier_id (snapshot at time of sale).
 * Margin requires order_items.supplier_cost_centavos (migration 0025+).
 * Orders without supplier_cost_centavos are excluded from margin calculations.
 *
 * Fórmula de margem: unit_price_centavos - supplier_cost_centavos (per unit)
 * Para desconto Pix: usamos unit_price_centavos (preço efetivo cobrado).
 */
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

// ─── Period helpers ────────────────────────────────────────────────────────

export type PeriodKey = "hoje" | "7d" | "30d" | "90d" | "mes" | "mes_anterior" | "todos";

export function periodToRange(period: PeriodKey): { from: string | null; to: string | null } {
  const now = new Date();
  const sp = (d: Date) => {
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 10);
  };
  const todayStr = sp(now);

  switch (period) {
    case "hoje": {
      const from = new Date(`${todayStr}T00:00:00-03:00`);
      const to = new Date(from.getTime() + 24 * 3600 * 1000);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case "7d": {
      const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      return { from: from.toISOString(), to: null };
    }
    case "30d": {
      const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      return { from: from.toISOString(), to: null };
    }
    case "90d": {
      const from = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
      return { from: from.toISOString(), to: null };
    }
    case "mes": {
      const y = now.getFullYear();
      const m = now.getMonth();
      const from = new Date(Date.UTC(y, m, 1) + 3 * 3600 * 1000);
      return { from: from.toISOString(), to: null };
    }
    case "mes_anterior": {
      const y = now.getFullYear();
      const m = now.getMonth() - 1;
      const from = new Date(Date.UTC(y, m, 1) + 3 * 3600 * 1000);
      const to = new Date(Date.UTC(y, m + 1, 1) + 3 * 3600 * 1000);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case "todos":
      return { from: null, to: null };
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SupplierKpis {
  faturamento: number;
  unidadesVendidas: number;
  pedidosAtendidos: number;
  produtosAtivos: number;
  produtosSourcingAtual: number;
  produtosSemEstoque: number;
  ticketMedio: number;
  custoTotal: number;
  margemBruta: number;
  margemBrutaPct: number;
  participacaoPct: number;
  ultimaVenda: string | null;
  ultimoCatalogo: string | null;
  margemTraceable: boolean;
  itensNaoRastreaveis: number;
  dataInicioRastreavel: string | null;
}

export interface SupplierProduct {
  masterProductId: string;
  productId: string | null;
  name: string;
  sku: string | null;
  ean: string | null;
  images: string[];
  costCentavos: number | null;
  stock: number | null;
  leadTimeDays: number;
  offerStatus: string;
  offerId: string;
  isSourcingAtual: boolean;
  rankPosition: number | null;
  unidadesVendidas: number;
  faturamento: number;
  margemGerada: number;
  ultimaVenda: string | null;
}

export interface SupplierSale {
  orderId: string;
  orderCode: string;
  orderDate: string;
  orderStatus: string;
  productId: string;
  productName: string;
  qty: number;
  unitPriceCentavos: number;
  supplierCostCentavos: number | null;
  lineCentavos: number;
  margemCentavos: number | null;
}

export interface SupplierPerformance {
  produtosRank1: number;
  produtosAlternativa: number;
  vezesSourcingGanho: number;
  vezesSourcingPerdido: number;
  autoSwitchesEnvolvido: number;
  estoqueZeroOcorrencias: number;
  excecoesAbertas: number;
  alteracoesCusto: number;
  vezesInelegivel: number;
}

export interface SupplierRevenuePoint {
  date: string;
  faturamento: number;
  unidades: number;
}

export interface TopProduct {
  masterProductId: string;
  productName: string;
  images: string[];
  unidades: number;
  faturamento: number;
  participacaoPct: number;
  margemGerada: number;
  stock: number | null;
}

export interface SupplierAlert {
  type: "sem_estoque" | "estoque_baixo" | "oferta_inativa" | "sourcing_perdido" | "excecoes_abertas";
  count: number;
  label: string;
}

// ─── KPIs ──────────────────────────────────────────────────────────────────

export async function getSupplierKpis(
  supplierId: string,
  period: PeriodKey,
): Promise<SupplierKpis> {
  const sb = await createClient();
  const range = periodToRange(period);

  const [salesData, offersData, sourcingData, catalogData, totalRevenue] = await Promise.all([
    fetchSupplierSales(sb, supplierId, range),
    fetchSupplierOffers(sb, supplierId),
    fetchSourcingForSupplier(sb, supplierId),
    fetchLatestCatalog(sb, supplierId),
    fetchTotalRevenue(sb, range),
  ]);

  const orderIds = new Set<string>();
  let faturamento = 0;
  let unidades = 0;
  let custoTotal = 0;
  let margemBruta = 0;
  let itensNaoRastreaveis = 0;
  let earliestTraceable: string | null = null;
  let ultimaVenda: string | null = null;

  for (const s of salesData) {
    orderIds.add(s.order_id);
    faturamento += s.line_centavos;
    unidades += s.qty;
    if (s.supplier_cost_centavos != null) {
      const itemCost = s.supplier_cost_centavos * s.qty;
      custoTotal += itemCost;
      margemBruta += s.line_centavos - itemCost;
    } else {
      itensNaoRastreaveis++;
    }
    if (!ultimaVenda || s.order_created_at > ultimaVenda) {
      ultimaVenda = s.order_created_at;
    }
    if (s.supplier_cost_centavos != null) {
      if (!earliestTraceable || s.order_created_at < earliestTraceable) {
        earliestTraceable = s.order_created_at;
      }
    }
  }

  const produtosSemEstoque = offersData.filter(
    (o) => o.status === "ativa" && o.stock != null && o.stock <= 0,
  ).length;

  const ticketMedio = orderIds.size > 0
    ? Math.round(faturamento / orderIds.size)
    : 0;

  return {
    faturamento,
    unidadesVendidas: unidades,
    pedidosAtendidos: orderIds.size,
    produtosAtivos: offersData.filter((o) => o.status === "ativa").length,
    produtosSourcingAtual: sourcingData.length,
    produtosSemEstoque,
    ticketMedio,
    custoTotal,
    margemBruta,
    margemBrutaPct: faturamento > 0 ? Math.round((margemBruta / faturamento) * 10000) / 100 : 0,
    participacaoPct: totalRevenue > 0 ? Math.round((faturamento / totalRevenue) * 10000) / 100 : 0,
    ultimaVenda,
    ultimoCatalogo: catalogData,
    margemTraceable: itensNaoRastreaveis === 0 && salesData.length > 0,
    itensNaoRastreaveis,
    dataInicioRastreavel: earliestTraceable,
  };
}

// ─── Products ──────────────────────────────────────────────────────────────

export async function getSupplierProducts(
  supplierId: string,
  period: PeriodKey,
): Promise<SupplierProduct[]> {
  const sb = await createClient();
  const range = periodToRange(period);

  const [offers, sourcingSet, salesByMaster] = await Promise.all([
    fetchSupplierOffersDetailed(sb, supplierId),
    fetchSourcingMasterIds(sb, supplierId),
    fetchSalesByMasterProduct(sb, supplierId, range),
  ]);

  return offers.map((o) => {
    const sales = salesByMaster.get(o.master_product_id) ?? { units: 0, revenue: 0, margin: 0, lastSale: null };
    return {
      masterProductId: o.master_product_id,
      productId: o.product_id,
      name: o.master_name,
      sku: o.supplier_sku,
      ean: o.ean,
      images: o.images,
      costCentavos: o.cost_centavos,
      stock: o.stock,
      leadTimeDays: o.lead_time_days,
      offerStatus: o.status,
      offerId: o.id,
      isSourcingAtual: sourcingSet.has(o.master_product_id),
      rankPosition: null,
      unidadesVendidas: sales.units,
      faturamento: sales.revenue,
      margemGerada: sales.margin,
      ultimaVenda: sales.lastSale,
    };
  });
}

// ─── Sales ─────────────────────────────────────────────────────────────────

export async function getSupplierSales(
  supplierId: string,
  period: PeriodKey,
  page: number,
  perPage: number,
): Promise<{ sales: SupplierSale[]; total: number }> {
  const sb = await createClient();
  const range = periodToRange(period);

  let query = sb
    .from("order_items")
    .select("id, order_id, product_id, name, qty, unit_price_centavos, supplier_cost_centavos, line_centavos, orders!inner(id, code, created_at, order_status, revenue_excluded)", { count: "exact" })
    .eq("supplier_id", supplierId)
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data, count } = await query
    .order("orders(created_at)", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const sales: SupplierSale[] = ((data ?? []) as any[]).map((r) => ({
    orderId: r.orders.id,
    orderCode: r.orders.code,
    orderDate: r.orders.created_at,
    orderStatus: r.orders.order_status,
    productId: r.product_id,
    productName: r.name,
    qty: r.qty,
    unitPriceCentavos: r.unit_price_centavos,
    supplierCostCentavos: r.supplier_cost_centavos,
    lineCentavos: r.line_centavos,
    margemCentavos: r.supplier_cost_centavos != null
      ? r.line_centavos - r.supplier_cost_centavos * r.qty
      : null,
  }));

  return { sales, total: count ?? 0 };
}

// ─── Performance ───────────────────────────────────────────────────────────

export async function getSupplierPerformance(supplierId: string): Promise<SupplierPerformance> {
  const sb = await createClient();

  const [
    sourcingActive,
    sourcingHistory,
    replacements,
    exceptions,
    priceChanges,
    offers,
  ] = await Promise.all([
    sb.from("sourcing_selections")
      .select("id, supplier_offer_id, supplier_offers!inner(supplier_id)")
      .is("replaced_at", null)
      .eq("supplier_offers.supplier_id", supplierId),
    sb.from("sourcing_selections")
      .select("id, replaced_at, supplier_offer_id, supplier_offers!inner(supplier_id)")
      .eq("supplier_offers.supplier_id", supplierId),
    sb.from("supplier_replacement_log")
      .select("id, old_supplier_id, new_supplier_id, auto_applied")
      .or(`old_supplier_id.eq.${supplierId},new_supplier_id.eq.${supplierId}`),
    sb.from("procurement_exceptions")
      .select("id, status")
      .eq("supplier_id", supplierId)
      .eq("status", "open"),
    sb.from("price_change_log")
      .select("id")
      .eq("supplier_id", supplierId),
    sb.from("supplier_offers")
      .select("id, stock, status")
      .eq("supplier_id", supplierId)
      .eq("status", "ativa"),
  ]);

  const replacementData = (replacements.data ?? []) as any[];
  const gained = replacementData.filter((r) => r.new_supplier_id === supplierId).length;
  const lost = replacementData.filter((r) => r.old_supplier_id === supplierId).length;
  const autoSwitches = replacementData.filter((r) => r.auto_applied).length;
  const stockZero = ((offers.data ?? []) as any[]).filter((o) => o.stock != null && o.stock <= 0).length;

  const allSelections = (sourcingHistory.data ?? []) as any[];
  const activeSelections = (sourcingActive.data ?? []) as any[];

  const allOffers = ((offers.data ?? []) as any[]);
  const alternativeCount = allOffers.length - activeSelections.length;

  return {
    produtosRank1: activeSelections.length,
    produtosAlternativa: Math.max(0, alternativeCount),
    vezesSourcingGanho: gained,
    vezesSourcingPerdido: lost,
    autoSwitchesEnvolvido: autoSwitches,
    estoqueZeroOcorrencias: stockZero,
    excecoesAbertas: (exceptions.data ?? []).length,
    alteracoesCusto: (priceChanges.data ?? []).length,
    vezesInelegivel: lost,
  };
}

// ─── Revenue over time ────────────────────────────────────────────────────

export async function getSupplierRevenueTimeline(
  supplierId: string,
  period: PeriodKey,
): Promise<SupplierRevenuePoint[]> {
  const sb = await createClient();
  const range = periodToRange(period);

  let query = sb
    .from("order_items")
    .select("line_centavos, qty, orders!inner(created_at, revenue_excluded)")
    .eq("supplier_id", supplierId)
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const byDate = new Map<string, { faturamento: number; unidades: number }>();
  for (const r of data as any[]) {
    const d = new Date(r.orders.created_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const acc = byDate.get(d) ?? { faturamento: 0, unidades: 0 };
    acc.faturamento += r.line_centavos;
    acc.unidades += r.qty;
    byDate.set(d, acc);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, faturamento: v.faturamento, unidades: v.unidades }));
}

// ─── Top products ──────────────────────────────────────────────────────────

export async function getSupplierTopProducts(
  supplierId: string,
  period: PeriodKey,
  sortBy: "unidades" | "faturamento" = "faturamento",
  limit = 10,
): Promise<TopProduct[]> {
  const sb = await createClient();
  const range = periodToRange(period);

  let query = sb
    .from("order_items")
    .select("product_id, name, qty, line_centavos, supplier_cost_centavos, master_product_id, orders!inner(created_at, revenue_excluded)")
    .eq("supplier_id", supplierId)
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const map = new Map<string, {
    name: string; productId: string; masterProductId: string | null;
    units: number; revenue: number; margin: number;
  }>();

  for (const r of data as any[]) {
    const key = r.product_id;
    const acc = map.get(key) ?? {
      name: r.name, productId: r.product_id,
      masterProductId: r.master_product_id, units: 0, revenue: 0, margin: 0,
    };
    acc.units += r.qty;
    acc.revenue += r.line_centavos;
    if (r.supplier_cost_centavos != null) {
      acc.margin += r.line_centavos - r.supplier_cost_centavos * r.qty;
    }
    map.set(key, acc);
  }

  const totalRevenue = [...map.values()].reduce((s, p) => s + p.revenue, 0);
  const sorted = [...map.values()].sort((a, b) =>
    sortBy === "unidades" ? b.units - a.units : b.revenue - a.revenue,
  );

  const productIds = sorted.slice(0, limit).map((p) => p.productId);
  const { data: products } = await sb
    .from("products")
    .select("id, images, stock")
    .in("id", productIds.length > 0 ? productIds : ["__none__"]);
  const prodMap = new Map<string, any>();
  for (const p of (products ?? []) as any[]) prodMap.set(p.id, p);

  return sorted.slice(0, limit).map((p) => {
    const prod = prodMap.get(p.productId);
    return {
      masterProductId: p.masterProductId ?? p.productId,
      productName: p.name,
      images: prod?.images ?? [],
      unidades: p.units,
      faturamento: p.revenue,
      participacaoPct: totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 10000) / 100 : 0,
      margemGerada: p.margin,
      stock: prod?.stock ?? null,
    };
  });
}

// ─── Alerts ────────────────────────────────────────────────────────────────

export async function getSupplierAlerts(supplierId: string): Promise<SupplierAlert[]> {
  const sb = await createClient();

  const [offers, replacements30d, exceptions] = await Promise.all([
    sb.from("supplier_offers")
      .select("id, stock, status")
      .eq("supplier_id", supplierId),
    sb.from("supplier_replacement_log")
      .select("id")
      .eq("old_supplier_id", supplierId)
      .gte("created_at", new Date(Date.now() - 30 * 86400 * 1000).toISOString()),
    sb.from("procurement_exceptions")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("status", "open"),
  ]);

  const offersData = (offers.data ?? []) as any[];
  const alerts: SupplierAlert[] = [];

  const semEstoque = offersData.filter((o) => o.status === "ativa" && o.stock != null && o.stock <= 0).length;
  if (semEstoque > 0) alerts.push({ type: "sem_estoque", count: semEstoque, label: `${semEstoque} produto(s) sem estoque` });

  const inativas = offersData.filter((o) => o.status !== "ativa").length;
  if (inativas > 0) alerts.push({ type: "oferta_inativa", count: inativas, label: `${inativas} oferta(s) inativa(s)` });

  const perdidos = (replacements30d.data ?? []).length;
  if (perdidos > 0) alerts.push({ type: "sourcing_perdido", count: perdidos, label: `${perdidos} produto(s) perderam sourcing nos últimos 30 dias` });

  const excecoes = (exceptions.data ?? []).length;
  if (excecoes > 0) alerts.push({ type: "excecoes_abertas", count: excecoes, label: `${excecoes} exceção(ões) aberta(s)` });

  return alerts;
}

// ─── Catalog items drill-down ─────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  supplierSku: string | null;
  name: string;
  ean: string | null;
  costCentavos: number | null;
  stock: number | null;
  matchStatus: string;
  masterProductId: string | null;
  masterProductName: string | null;
  offerStatus: string | null;
}

export async function getCatalogItems(catalogId: string): Promise<CatalogItem[]> {
  const sb = await createClient();

  const { data: catalogData } = await sb
    .from("supplier_catalog_items")
    .select("id, supplier_id, supplier_sku, name, ean, cost_centavos, stock, match_status, master_product_id, master_products(name)")
    .eq("catalog_id", catalogId)
    .order("name", { ascending: true })
    .limit(500);

  const items = (catalogData ?? []) as any[];
  if (items.length === 0) return [];

  const masterIds = [...new Set(items.map((r) => r.master_product_id).filter(Boolean))];
  const supplierId = items[0]?.supplier_id;

  let offerMap = new Map<string, string>();
  if (masterIds.length > 0 && supplierId) {
    const { data: offers } = await sb
      .from("supplier_offers")
      .select("master_product_id, status")
      .eq("supplier_id", supplierId)
      .in("master_product_id", masterIds);
    for (const o of (offers ?? []) as any[]) {
      offerMap.set(o.master_product_id, o.status);
    }
  }

  return items.map((r) => ({
    id: r.id,
    supplierSku: r.supplier_sku ?? null,
    name: r.name ?? "—",
    ean: r.ean ?? null,
    costCentavos: r.cost_centavos ?? null,
    stock: r.stock ?? null,
    matchStatus: r.match_status ?? "pendente",
    masterProductId: r.master_product_id ?? null,
    masterProductName: r.master_products?.name ?? null,
    offerStatus: r.master_product_id ? (offerMap.get(r.master_product_id) ?? null) : null,
  }));
}

// ─── Supplier list summary (for /admin/fornecedores) ──────────────────────

export interface SupplierListSummary {
  supplierId: string;
  faturamento30d: number;
  unidades30d: number;
  produtosAtivos: number;
  ultimaVenda: string | null;
}

export async function getSupplierListSummaries(): Promise<Map<string, SupplierListSummary>> {
  const sb = await createClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

  const [salesData, offersData] = await Promise.all([
    sb
      .from("order_items")
      .select("supplier_id, qty, line_centavos, orders!inner(created_at, revenue_excluded)")
      .not("supplier_id", "is", null)
      .eq("orders.revenue_excluded", false)
      .gte("orders.created_at", thirtyDaysAgo),
    sb
      .from("supplier_offers")
      .select("supplier_id")
      .eq("status", "ativa"),
  ]);

  const map = new Map<string, SupplierListSummary>();

  for (const r of (salesData.data ?? []) as any[]) {
    const sid = r.supplier_id;
    const acc = map.get(sid) ?? { supplierId: sid, faturamento30d: 0, unidades30d: 0, produtosAtivos: 0, ultimaVenda: null };
    acc.faturamento30d += r.line_centavos;
    acc.unidades30d += r.qty;
    if (!acc.ultimaVenda || r.orders.created_at > acc.ultimaVenda) {
      acc.ultimaVenda = r.orders.created_at;
    }
    map.set(sid, acc);
  }

  for (const r of (offersData.data ?? []) as any[]) {
    const acc = map.get(r.supplier_id) ?? { supplierId: r.supplier_id, faturamento30d: 0, unidades30d: 0, produtosAtivos: 0, ultimaVenda: null };
    acc.produtosAtivos++;
    map.set(r.supplier_id, acc);
  }

  return map;
}

// ─── Product drill-down ──────────────────────────────────────────────────

export interface ProductDrilldownData {
  offer: { id: string; master_product_id: string; cost_centavos: number; stock: number | null; lead_time_days: number; status: string } | null;
  masterProduct: { id: string; name: string; ean: string | null; images: string[] } | null;
  supplierSku: string | null;
  supplierName: string;

  isSourcingAtual: boolean;
  sourcingStatus: "atual" | "alternativa" | "inelegivel";

  rankPosition: number | null;
  rankScore: number | null;

  competitors: Array<{
    supplierId: string;
    supplierName: string;
    costCentavos: number;
    stock: number | null;
    leadTimeDays: number;
    score: number | null;
    position: number | null;
    isCurrent: boolean;
  }>;

  salesKpis: {
    unidades: number;
    faturamento: number;
    pedidos: number;
    custoTotal: number;
    margemBruta: number;
    ticketMedio: number;
    ultimaVenda: string | null;
    itensNaoRastreaveis: number;
  };

  sales: Array<{
    orderCode: string;
    orderDate: string;
    qty: number;
    unitPriceCentavos: number;
    supplierCostCentavos: number | null;
    lineCentavos: number;
    margemCentavos: number | null;
  }>;

  history: SupplierHistoryEvent[];
}

export async function getProductDrilldownData(
  supplierId: string,
  masterProductId: string,
): Promise<ProductDrilldownData | null> {
  const { rankProductOffers } = await import("@/lib/ranking/engine");
  const sb = await createClient();

  const [offerRes, supplierRes, allOffersRes, sourcingRes, salesRes, historyData] = await Promise.all([
    sb.from("supplier_offers")
      .select(`
        id, master_product_id, cost_centavos, stock, status, lead_time_days,
        master_products!inner(id, name, ean, images),
        supplier_catalog_items(supplier_sku)
      `)
      .eq("supplier_id", supplierId)
      .eq("master_product_id", masterProductId)
      .limit(1)
      .maybeSingle(),
    sb.from("suppliers").select("id, name").eq("id", supplierId).single(),
    sb.from("supplier_offers")
      .select("id, master_product_id, supplier_id, cost_centavos, stock, status, lead_time_days, suppliers!inner(name)")
      .eq("master_product_id", masterProductId)
      .eq("status", "ativa"),
    sb.from("sourcing_selections")
      .select("id, supplier_offer_id")
      .eq("master_product_id", masterProductId)
      .is("replaced_at", null)
      .limit(1)
      .maybeSingle(),
    sb.from("order_items")
      .select("order_id, qty, unit_price_centavos, supplier_cost_centavos, line_centavos, orders!inner(id, code, created_at, order_status, revenue_excluded)")
      .eq("supplier_id", supplierId)
      .eq("master_product_id", masterProductId)
      .eq("orders.revenue_excluded", false)
      .order("orders(created_at)", { ascending: false })
      .limit(200),
    fetchProductHistory(sb, supplierId, masterProductId),
  ]);

  const supplierName = (supplierRes.data as any)?.name ?? "—";

  const offerRow = offerRes.data as any;
  const offer = offerRow ? {
    id: offerRow.id,
    master_product_id: offerRow.master_product_id,
    cost_centavos: offerRow.cost_centavos,
    stock: offerRow.stock,
    lead_time_days: offerRow.lead_time_days,
    status: offerRow.status,
  } : null;

  const masterProduct = offerRow?.master_products ? {
    id: offerRow.master_products.id,
    name: offerRow.master_products.name,
    ean: offerRow.master_products.ean ?? null,
    images: offerRow.master_products.images ?? [],
  } : null;

  const supplierSku = offerRow?.supplier_catalog_items?.[0]?.supplier_sku ?? null;

  // Ranking
  const allOffers = ((allOffersRes.data ?? []) as any[]);
  const rankableOffers = allOffers.map((o: any) => ({
    id: o.id,
    master_product_id: o.master_product_id,
    supplier_id: o.supplier_id,
    cost_centavos: o.cost_centavos,
    stock: o.stock,
    lead_time_days: o.lead_time_days,
    status: o.status,
  }));

  const ranking = rankProductOffers(rankableOffers);
  const rankedMap = new Map<string, { position: number; score: number }>();
  if (ranking) {
    for (const ro of ranking.offers) {
      rankedMap.set(ro.supplier_offer_id, { position: ro.position, score: ro.score_total });
    }
  }

  const myRank = offer ? rankedMap.get(offer.id) : null;
  const currentSourcingOfferId = (sourcingRes.data as any)?.supplier_offer_id ?? null;
  const isSourcingAtual = offer ? currentSourcingOfferId === offer.id : false;

  let sourcingStatus: "atual" | "alternativa" | "inelegivel" = "alternativa";
  if (isSourcingAtual) sourcingStatus = "atual";
  else if (!offer || offer.status !== "ativa" || (offer.stock != null && offer.stock <= 0)) sourcingStatus = "inelegivel";

  // Competitors
  const competitors = allOffers.map((o: any) => {
    const rk = rankedMap.get(o.id);
    return {
      supplierId: o.supplier_id,
      supplierName: o.suppliers?.name ?? "—",
      costCentavos: o.cost_centavos,
      stock: o.stock,
      leadTimeDays: o.lead_time_days,
      score: rk?.score ?? null,
      position: rk?.position ?? null,
      isCurrent: currentSourcingOfferId === o.id,
    };
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  // Sales
  const salesRows = ((salesRes.data ?? []) as any[]);
  const orderIds = new Set<string>();
  let faturamento = 0;
  let unidades = 0;
  let custoTotal = 0;
  let margemBruta = 0;
  let itensNaoRastreaveis = 0;
  let ultimaVenda: string | null = null;

  for (const r of salesRows) {
    orderIds.add(r.order_id);
    faturamento += r.line_centavos;
    unidades += r.qty;
    if (r.supplier_cost_centavos != null) {
      const itemCost = r.supplier_cost_centavos * r.qty;
      custoTotal += itemCost;
      margemBruta += r.line_centavos - itemCost;
    } else {
      itensNaoRastreaveis++;
    }
    if (!ultimaVenda || r.orders.created_at > ultimaVenda) ultimaVenda = r.orders.created_at;
  }

  const sales = salesRows.map((r: any) => ({
    orderCode: r.orders.code,
    orderDate: r.orders.created_at,
    qty: r.qty,
    unitPriceCentavos: r.unit_price_centavos,
    supplierCostCentavos: r.supplier_cost_centavos,
    lineCentavos: r.line_centavos,
    margemCentavos: r.supplier_cost_centavos != null ? r.line_centavos - r.supplier_cost_centavos * r.qty : null,
  }));

  return {
    offer,
    masterProduct,
    supplierSku,
    supplierName,
    isSourcingAtual,
    sourcingStatus,
    rankPosition: myRank?.position ?? null,
    rankScore: myRank?.score ?? null,
    competitors,
    salesKpis: {
      unidades,
      faturamento,
      pedidos: orderIds.size,
      custoTotal,
      margemBruta,
      ticketMedio: orderIds.size > 0 ? Math.round(faturamento / orderIds.size) : 0,
      ultimaVenda,
      itensNaoRastreaveis,
    },
    sales,
    history: historyData,
  };
}

async function fetchProductHistory(
  sb: SB,
  supplierId: string,
  masterProductId: string,
): Promise<SupplierHistoryEvent[]> {
  const [replacements, priceChanges, exceptions] = await Promise.all([
    sb.from("supplier_replacement_log")
      .select("id, created_at, old_supplier_id, new_supplier_id, reason, note")
      .eq("master_product_id", masterProductId)
      .or(`old_supplier_id.eq.${supplierId},new_supplier_id.eq.${supplierId}`)
      .order("created_at", { ascending: false })
      .limit(30),
    sb.from("price_change_log")
      .select("id, created_at, old_price_centavos, new_price_centavos, reason")
      .eq("supplier_id", supplierId)
      .eq("master_product_id", masterProductId)
      .order("created_at", { ascending: false })
      .limit(30),
    sb.from("procurement_exceptions")
      .select("id, created_at, type, status")
      .eq("supplier_id", supplierId)
      .eq("master_product_id", masterProductId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const events: SupplierHistoryEvent[] = [];

  for (const r of (replacements.data ?? []) as any[]) {
    const isNew = r.new_supplier_id === supplierId;
    events.push({
      id: `repl-${r.id}`,
      type: "troca_fornecedor",
      timestamp: r.created_at,
      title: isNew ? "Ganhou sourcing" : "Perdeu sourcing",
      description: r.reason ?? r.note ?? "",
      productName: null,
    });
  }

  for (const r of (priceChanges.data ?? []) as any[]) {
    const old = (r.old_price_centavos / 100).toFixed(2);
    const nw = (r.new_price_centavos / 100).toFixed(2);
    events.push({
      id: `price-${r.id}`,
      type: "alteracao_preco",
      timestamp: r.created_at,
      title: `Preço: R$ ${old} → R$ ${nw}`,
      description: r.reason ?? "",
      productName: null,
    });
  }

  for (const r of (exceptions.data ?? []) as any[]) {
    events.push({
      id: `exc-${r.id}`,
      type: "excecao_detectada",
      timestamp: r.created_at,
      title: `Exceção: ${r.type}`,
      description: `Status: ${r.status}`,
      productName: null,
    });
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events.slice(0, 50);
}

// ─── Supplier history (timeline) ─────────────────────────────────────────

export interface SupplierHistoryEvent {
  id: string;
  type: "troca_fornecedor" | "alteracao_preco" | "excecao_detectada" | "selecao_sourcing";
  timestamp: string;
  title: string;
  description: string;
  productName: string | null;
}

export async function getSupplierHistory(
  supplierId: string,
  limit = 50,
): Promise<SupplierHistoryEvent[]> {
  const sb = await createClient();

  const [replacements, priceChanges, exceptions] = await Promise.all([
    sb.from("supplier_replacement_log")
      .select("id, created_at, old_supplier_id, new_supplier_id, reason, note, master_products(name)")
      .or(`old_supplier_id.eq.${supplierId},new_supplier_id.eq.${supplierId}`)
      .order("created_at", { ascending: false })
      .limit(limit),
    sb.from("price_change_log")
      .select("id, created_at, old_price_centavos, new_price_centavos, reason, products(name)")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
      .limit(limit),
    sb.from("procurement_exceptions")
      .select("id, created_at, type, status, master_products(name)")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const events: SupplierHistoryEvent[] = [];

  for (const r of (replacements.data ?? []) as any[]) {
    const isNew = r.new_supplier_id === supplierId;
    events.push({
      id: `repl-${r.id}`,
      type: "troca_fornecedor",
      timestamp: r.created_at,
      title: isNew ? "Ganhou sourcing de produto" : "Perdeu sourcing de produto",
      description: r.reason ?? r.note ?? "",
      productName: r.master_products?.name ?? null,
    });
  }

  for (const r of (priceChanges.data ?? []) as any[]) {
    const old = (r.old_price_centavos / 100).toFixed(2);
    const nw = (r.new_price_centavos / 100).toFixed(2);
    events.push({
      id: `price-${r.id}`,
      type: "alteracao_preco",
      timestamp: r.created_at,
      title: `Preço alterado: R$ ${old} → R$ ${nw}`,
      description: r.reason ?? "",
      productName: r.products?.name ?? null,
    });
  }

  for (const r of (exceptions.data ?? []) as any[]) {
    events.push({
      id: `exc-${r.id}`,
      type: "excecao_detectada",
      timestamp: r.created_at,
      title: `Exceção: ${r.type}`,
      description: `Status: ${r.status}`,
      productName: r.master_products?.name ?? null,
    });
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events.slice(0, limit);
}

// ─── Internal query helpers ────────────────────────────────────────────────

interface SaleRow {
  order_id: string;
  line_centavos: number;
  qty: number;
  supplier_cost_centavos: number | null;
  order_created_at: string;
}

async function fetchSupplierSales(
  sb: SB,
  supplierId: string,
  range: { from: string | null; to: string | null },
): Promise<SaleRow[]> {
  let query = sb
    .from("order_items")
    .select("order_id, line_centavos, qty, supplier_cost_centavos, orders!inner(created_at, revenue_excluded)")
    .eq("supplier_id", supplierId)
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data } = await query;
  return ((data ?? []) as any[]).map((r: any) => ({
    order_id: r.order_id,
    line_centavos: r.line_centavos,
    qty: r.qty,
    supplier_cost_centavos: r.supplier_cost_centavos,
    order_created_at: r.orders.created_at,
  }));
}

async function fetchSupplierOffers(sb: SB, supplierId: string) {
  const { data } = await sb
    .from("supplier_offers")
    .select("id, master_product_id, cost_centavos, stock, status, lead_time_days")
    .eq("supplier_id", supplierId);
  return (data ?? []) as any[];
}

async function fetchSupplierOffersDetailed(sb: SB, supplierId: string) {
  const { data } = await sb
    .from("supplier_offers")
    .select(`
      id, master_product_id, cost_centavos, stock, status, lead_time_days,
      master_products!inner(id, name, ean, images),
      supplier_catalog_items(supplier_sku)
    `)
    .eq("supplier_id", supplierId)
    .eq("status", "ativa");

  return ((data ?? []) as any[]).map((r: any) => ({
    id: r.id,
    master_product_id: r.master_product_id,
    master_name: r.master_products?.name ?? "—",
    ean: r.master_products?.ean ?? null,
    images: r.master_products?.images ?? [],
    cost_centavos: r.cost_centavos,
    stock: r.stock,
    lead_time_days: r.lead_time_days,
    status: r.status,
    supplier_sku: r.supplier_catalog_items?.[0]?.supplier_sku ?? null,
    product_id: null as string | null,
  }));
}

async function fetchSourcingForSupplier(sb: SB, supplierId: string) {
  const { data } = await sb
    .from("sourcing_selections")
    .select("id, master_product_id, supplier_offer_id, supplier_offers!inner(supplier_id)")
    .is("replaced_at", null)
    .eq("supplier_offers.supplier_id", supplierId);
  return (data ?? []) as any[];
}

async function fetchSourcingMasterIds(sb: SB, supplierId: string): Promise<Set<string>> {
  const data = await fetchSourcingForSupplier(sb, supplierId);
  return new Set(data.map((s: any) => s.master_product_id));
}

async function fetchLatestCatalog(sb: SB, supplierId: string): Promise<string | null> {
  const { data } = await sb
    .from("supplier_catalogs")
    .select("created_at")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return data?.created_at ?? null;
}

async function fetchTotalRevenue(
  sb: SB,
  range: { from: string | null; to: string | null },
): Promise<number> {
  let query = sb
    .from("order_items")
    .select("line_centavos, orders!inner(created_at, revenue_excluded)")
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data } = await query;
  return ((data ?? []) as any[]).reduce((s: number, r: any) => s + r.line_centavos, 0);
}

async function fetchSalesByMasterProduct(
  sb: SB,
  supplierId: string,
  range: { from: string | null; to: string | null },
): Promise<Map<string, { units: number; revenue: number; margin: number; lastSale: string | null }>> {
  let query = sb
    .from("order_items")
    .select("master_product_id, product_id, qty, line_centavos, supplier_cost_centavos, orders!inner(created_at, revenue_excluded)")
    .eq("supplier_id", supplierId)
    .not("master_product_id", "is", null)
    .eq("orders.revenue_excluded", false);

  if (range.from) query = query.gte("orders.created_at", range.from);
  if (range.to) query = query.lt("orders.created_at", range.to);

  const { data } = await query;
  const map = new Map<string, { units: number; revenue: number; margin: number; lastSale: string | null }>();

  for (const r of (data ?? []) as any[]) {
    const key = r.master_product_id;
    const acc = map.get(key) ?? { units: 0, revenue: 0, margin: 0, lastSale: null };
    acc.units += r.qty;
    acc.revenue += r.line_centavos;
    if (r.supplier_cost_centavos != null) {
      acc.margin += r.line_centavos - r.supplier_cost_centavos * r.qty;
    }
    if (!acc.lastSale || r.orders.created_at > acc.lastSale) {
      acc.lastSale = r.orders.created_at;
    }
    map.set(key, acc);
  }

  return map;
}

