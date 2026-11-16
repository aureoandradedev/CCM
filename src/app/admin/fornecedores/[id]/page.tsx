import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { CommercialTermsAdmin } from "@/components/admin/commercial-terms-admin";
import { SupplierForm } from "@/components/admin/settings-forms";
import { adminSupplierById, adminSupplierCommercialTerms, adminSupplierCatalogs, configured } from "@/lib/admin/data";
import { maskCNPJ } from "@/lib/utils/masks";
import {
  getSupplierKpis,
  getSupplierProducts,
  getSupplierSales,
  getSupplierPerformance,
  getSupplierRevenueTimeline,
  getSupplierTopProducts,
  getSupplierAlerts,
  getSupplierHistory,
  type PeriodKey,
} from "@/lib/admin/supplier-bi-data";
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
  DataSection,
  type TabKey,
} from "./_supplier-bi-client";

const VALID_TABS: TabKey[] = ["visao-geral", "produtos", "vendas", "desempenho", "catalogos", "historico", "dados"];
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
  const tab = (VALID_TABS.includes(sp.tab as TabKey) ? sp.tab : "visao-geral") as TabKey;
  const period = (VALID_PERIODS.includes(sp.period as PeriodKey) ? sp.period : "30d") as PeriodKey;
  const salesPage = Math.max(1, parseInt(String(sp.page ?? "1"), 10) || 1);
  const salesPerPage = 20;

  const supplier = await adminSupplierById(id);
  if (!supplier) notFound();

  return (
    <>
      <Link
        href="/admin/fornecedores"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Fornecedores
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          title={supplier.name}
          subtitle={supplier.active ? (supplier.trade_name ?? undefined) : "Fornecedor inativo"}
        />
        <Link
          href={`/admin/automacao?search=${encodeURIComponent(supplier.name)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-card px-3 py-1.5 text-xs font-semibold text-brand-ink-soft transition hover:text-brand-navy"
        >
          <ExternalLink className="size-3.5" /> Central Operacional
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <TabNav current={tab} />
      </div>

      {tab !== "dados" && tab !== "historico" && tab !== "catalogos" && (
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
      {tab === "dados" && <DadosTab supplierId={id} />}
    </>
  );
}

// ─── Tab: Visão geral ───────────────────────────────────────────────────────

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

// ─── Tab: Produtos ──────────────────────────────────────────────────────────

async function ProductsTab({ supplierId, period }: { supplierId: string; period: PeriodKey }) {
  const products = await getSupplierProducts(supplierId, period);

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Produtos com oferta ativa</h2>
      <ProductsTable products={products} supplierId={supplierId} />
    </div>
  );
}

// ─── Tab: Vendas ────────────────────────────────────────────────────────────

async function SalesTab({
  supplierId,
  period,
  page,
  perPage,
}: {
  supplierId: string;
  period: PeriodKey;
  page: number;
  perPage: number;
}) {
  const { sales, total } = await getSupplierSales(supplierId, period, page, perPage);

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Vendas atribuídas</h2>
      <SalesTable sales={sales} total={total} page={page} perPage={perPage} />
    </div>
  );
}

// ─── Tab: Desempenho ────────────────────────────────────────────────────────

async function PerformanceTab({ supplierId, period }: { supplierId: string; period: PeriodKey }) {
  const [perf, timeline] = await Promise.all([
    getSupplierPerformance(supplierId),
    getSupplierRevenueTimeline(supplierId, period),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="font-heading text-lg font-bold text-brand-navy">Indicadores operacionais</h2>
      <PerformanceGrid perf={perf} />
      <RevenueChart data={timeline} />
    </div>
  );
}

// ─── Tab: Catálogos ─────────────────────────────────────────────────────────

async function CatalogsTab({ supplierId }: { supplierId: string }) {
  const catalogs = await adminSupplierCatalogs(supplierId);
  return <CatalogsSection catalogs={catalogs} supplierId={supplierId} />;
}

// ─── Tab: Histórico ─────────────────────────────────────────────────────────

async function HistoryTab({ supplierId }: { supplierId: string }) {
  const events = await getSupplierHistory(supplierId, 50);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold text-brand-navy">Histórico de automação</h2>
        <Link
          href={`/admin/automacao?search=${encodeURIComponent("supplier:" + supplierId)}`}
          className="text-xs font-semibold text-brand-navy hover:underline"
        >
          Ver na Central Operacional
        </Link>
      </div>
      <HistoryTimeline events={events} />
    </div>
  );
}

// ─── Tab: Dados e condições ─────────────────────────────────────────────────

async function DadosTab({ supplierId }: { supplierId: string }) {
  const [supplier, terms] = await Promise.all([
    adminSupplierById(supplierId),
    adminSupplierCommercialTerms(supplierId),
  ]);
  if (!supplier) return null;

  return (
    <div className="space-y-8">
      <DataSection supplier={supplier} terms={terms} />

      <details className="rounded-2xl border border-brand-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-navy dark:text-foreground">
          Editar dados cadastrais
        </summary>
        <div className="px-4 pb-4">
          <SupplierForm supplier={supplier} />
        </div>
      </details>

      <CommercialTermsAdmin supplierId={supplierId} terms={terms} />
    </div>
  );
}
