import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { adminSupplierById, adminSupplierCatalogs, configured } from "@/lib/admin/data";
import {
  getSupplierKpis,
  getSupplierProducts,
  getSupplierSales,
  getSupplierPerformance,
  getSupplierRevenueTimeline,
  getSupplierTopProducts,
  getSupplierAlerts,
  getSupplierHistory,
  getSupplierOperationalEvents,
  type PeriodKey,
} from "@/lib/admin/supplier-bi-data";
import { aggregateOperationalKpis, type PerformanceEventType } from "@/lib/supplier-performance";
import { fetchOperationalKpis } from "@/app/admin/actions";
import { SupplierKpiPanel } from "@/components/admin/supplier-kpi-panel";
import {
  TabNav,
  PeriodSelector,
  KpiGrid,
  AlertsBar,
  ProductsTable,
  SalesTable,
  TopProductsRanking,
  PerformanceGrid,
  RevenueChart,
  CatalogsSection,
  HistoryTimeline,
  type TabKey,
} from "@/app/admin/fornecedores/[id]/_supplier-bi-client";

const VALID_TABS: TabKey[] = ["visao-geral", "produtos", "vendas", "desempenho", "catalogos", "historico"];
const VALID_PERIODS: PeriodKey[] = ["hoje", "7d", "30d", "90d", "mes", "mes_anterior", "todos"];

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!configured()) return <NotConfigured />;

  const { id } = await params;
  const sp = await searchParams;
  const rawTab = sp.tab as TabKey;
  const tab = (VALID_TABS.includes(rawTab) ? rawTab : "visao-geral") as TabKey;
  const period = (VALID_PERIODS.includes(sp.period as PeriodKey) ? sp.period : "30d") as PeriodKey;
  const salesPage = Math.max(1, parseInt(String(sp.page ?? "1"), 10) || 1);
  const salesPerPage = 20;

  const supplier = await adminSupplierById(id);
  if (!supplier) notFound();

  return (
    <>
      <Link
        href="/compras/fornecedores"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Fornecedores
      </Link>

      <PageTitle
        title={supplier.name}
        subtitle={supplier.active ? (supplier.trade_name ?? undefined) : "Fornecedor inativo"}
      />

      <div className="mt-4 flex items-center justify-between gap-4">
        <TabNav current={tab} excludeTabs={["dados"]} />
      </div>

      {tab !== "historico" && tab !== "catalogos" && (
        <div className="mb-6">
          <PeriodSelector current={period} />
        </div>
      )}

      {tab === "visao-geral" && <OverviewTab supplierId={id} period={period} />}
      {tab === "produtos" && <ProductsTab supplierId={id} period={period} />}
      {tab === "vendas" && <SalesTab supplierId={id} period={period} page={salesPage} perPage={salesPerPage} />}
      {tab === "desempenho" && <PerformanceTab supplierId={id} period={period} />}
      {tab === "catalogos" && <CatalogsTab supplierId={id} />}
      {tab === "historico" && <HistoryTab supplierId={id} />}
    </>
  );
}

async function OverviewTab({ supplierId, period }: { supplierId: string; period: PeriodKey }) {
  const [kpis, alerts, timeline, topByRevenue, topByUnits] = await Promise.all([
    getSupplierKpis(supplierId, period),
    getSupplierAlerts(supplierId),
    getSupplierRevenueTimeline(supplierId, period),
    getSupplierTopProducts(supplierId, period, "faturamento", 5),
    getSupplierTopProducts(supplierId, period, "unidades", 5),
  ]);

  return (
    <div className="space-y-6">
      <AlertsBar alerts={alerts} supplierId={supplierId} />
      <KpiGrid kpis={kpis} />
      <RevenueChart data={timeline} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopProductsRanking title="Top por faturamento" products={topByRevenue} supplierId={supplierId} />
        <TopProductsRanking title="Top por unidades" products={topByUnits} supplierId={supplierId} />
      </div>
    </div>
  );
}

async function ProductsTab({ supplierId, period }: { supplierId: string; period: PeriodKey }) {
  const products = await getSupplierProducts(supplierId, period);
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Produtos com oferta ativa</h2>
      <ProductsTable products={products} supplierId={supplierId} />
    </div>
  );
}

async function SalesTab({ supplierId, period, page, perPage }: { supplierId: string; period: PeriodKey; page: number; perPage: number }) {
  const { sales, total } = await getSupplierSales(supplierId, period, page, perPage);
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Vendas atribuídas</h2>
      <SalesTable sales={sales} total={total} page={page} perPage={perPage} />
    </div>
  );
}

async function PerformanceTab({ supplierId, period }: { supplierId: string; period: PeriodKey }) {
  const [perf, timeline, opEvents] = await Promise.all([
    getSupplierPerformance(supplierId),
    getSupplierRevenueTimeline(supplierId, period),
    getSupplierOperationalEvents(supplierId, "30d"),
  ]);

  const mapped = opEvents.map((e) => ({
    ...e,
    supplier_id: supplierId,
    event_type: e.event_type as PerformanceEventType,
  }));
  const initialKpis = mapped.length > 0 ? aggregateOperationalKpis(mapped) : null;

  return (
    <div className="space-y-6">
      <SupplierKpiPanel initialKpis={initialKpis} supplierId={supplierId} fetchKpis={fetchOperationalKpis} />
      <h2 className="font-heading text-lg font-bold text-brand-navy">Indicadores de sourcing</h2>
      <PerformanceGrid perf={perf} />
      <RevenueChart data={timeline} />
    </div>
  );
}

async function CatalogsTab({ supplierId }: { supplierId: string }) {
  const catalogs = await adminSupplierCatalogs(supplierId);
  return <CatalogsSection catalogs={catalogs} supplierId={supplierId} />;
}

async function HistoryTab({ supplierId }: { supplierId: string }) {
  const events = await getSupplierHistory(supplierId, 50);
  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Histórico de automação</h2>
      <HistoryTimeline events={events} />
    </div>
  );
}
