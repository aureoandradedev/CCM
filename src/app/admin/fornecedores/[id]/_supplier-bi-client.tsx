"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Bot,
  Calendar,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  CatalogItem,
  SupplierAlert,
  SupplierProduct,
  SupplierRevenuePoint,
  SupplierSale,
  SupplierPerformance,
  TopProduct,
  PeriodKey,
  SupplierHistoryEvent,
} from "@/lib/admin/supplier-bi-data";
import type { SupplierCatalogSummary } from "@/lib/admin/data";
import type { AdminSupplier, SupplierCommercialTerms } from "@/lib/admin/types";
import { fetchCatalogItemsAction } from "./bi-actions";

// ─── Period selector ───────────────────────────────────────────────────────

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mes_anterior", label: "Mês anterior" },
  { key: "todos", label: "Todos" },
];

export function PeriodSelector({ current }: { current: PeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setPeriod(p: PeriodKey) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", p);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPeriod(p.key)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            current === p.key
              ? "bg-brand-navy text-white"
              : "bg-muted text-brand-ink-soft hover:bg-brand-navy/10",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── Tab navigation ────────────────────────────────────────────────────────

const TABS = [
  { key: "visao-geral", label: "Visão geral" },
  { key: "produtos", label: "Produtos" },
  { key: "vendas", label: "Vendas" },
  { key: "desempenho", label: "Desempenho" },
  { key: "catalogos", label: "Catálogos" },
  { key: "historico", label: "Histórico" },
  { key: "dados", label: "Dados e condições" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function TabNav({ current }: { current: TabKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setTab(t: TabKey) {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", t);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-brand-line pb-px">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={cn(
            "shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
            current === t.key
              ? "border-brand-navy text-brand-navy"
              : "border-transparent text-brand-ink-soft hover:text-brand-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── KPIs section ──────────────────────────────────────────────────────────

function fmt(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function KpiGrid({
  kpis,
}: {
  kpis: {
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
  };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Faturamento" value={fmt(kpis.faturamento)} icon={<DollarSign className="size-5 text-green-600" />} />
        <KpiCard label="Unidades vendidas" value={String(kpis.unidadesVendidas)} icon={<Package className="size-5 text-blue-600" />} />
        <KpiCard label="Pedidos atendidos" value={String(kpis.pedidosAtendidos)} icon={<ShoppingCart className="size-5 text-brand-navy" />} />
        <KpiCard
          label="Ticket médio por pedido"
          value={fmt(kpis.ticketMedio)}
          hint="Soma dos itens deste fornecedor / nº de pedidos"
          icon={<BarChart3 className="size-5 text-purple-600" />}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Produtos ativos" value={String(kpis.produtosAtivos)} />
        <KpiCard label="Sourcing atual (#1)" value={String(kpis.produtosSourcingAtual)} />
        <KpiCard
          label="Sem estoque"
          value={String(kpis.produtosSemEstoque)}
          tone={kpis.produtosSemEstoque > 0 ? "red" : "green"}
        />
        <KpiCard
          label="Participação"
          value={`${kpis.participacaoPct}%`}
          hint="do faturamento total no período"
        />
      </div>

      {kpis.margemBruta !== 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <KpiCard label="Custo total (CMV)" value={fmt(kpis.custoTotal)} />
          <KpiCard label="Margem bruta" value={fmt(kpis.margemBruta)} tone={kpis.margemBruta > 0 ? "green" : "red"} />
          <KpiCard label="Margem bruta %" value={`${kpis.margemBrutaPct}%`} hint="(venda − custo) / venda" />
        </div>
      )}

      {kpis.itensNaoRastreaveis > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mb-0.5 mr-1 inline size-3.5" />
          {kpis.itensNaoRastreaveis} item(ns) de pedidos antigos sem snapshot de custo do fornecedor.
          Margem calculada apenas para itens com rastreabilidade completa.
          {kpis.dataInicioRastreavel && (
            <> Dados disponíveis a partir de {new Date(kpis.dataInicioRastreavel).toLocaleDateString("pt-BR")}.</>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-line bg-card p-3 text-sm">
          <span className="text-xs font-semibold uppercase text-brand-ink-soft">Última venda</span>
          <p className="mt-0.5 font-semibold text-brand-ink">
            {kpis.ultimaVenda
              ? new Date(kpis.ultimaVenda).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
              : "Nenhuma"}
          </p>
        </div>
        <div className="rounded-xl border border-brand-line bg-card p-3 text-sm">
          <span className="text-xs font-semibold uppercase text-brand-ink-soft">Último catálogo</span>
          <p className="mt-0.5 font-semibold text-brand-ink">
            {kpis.ultimoCatalogo
              ? new Date(kpis.ultimoCatalogo).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
              : "Nenhum importado"}
          </p>
        </div>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = "navy",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "navy" | "green" | "red";
  icon?: React.ReactNode;
}) {
  const tones = { navy: "text-brand-navy", green: "text-green-600", red: "text-red-600" };
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">{label}</p>
      <p className={cn("mt-1 flex items-center gap-2 font-heading text-2xl font-extrabold tabular-nums", tones[tone])}>
        {icon}
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-brand-ink-soft">{hint}</p>}
    </div>
  );
}

// ─── Alerts ────────────────────────────────────────────────────────────────

export function AlertsBar({ alerts, supplierId }: { alerts: SupplierAlert[]; supplierId: string }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {alerts.map((a) => (
        <Link
          key={a.type}
          href={`/admin/fornecedores/${supplierId}?tab=produtos&filter=${a.type}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
        >
          <AlertTriangle className="size-3.5" />
          {a.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Products table ────────────────────────────────────────────────────────

export function ProductsTable({
  products,
  supplierId,
}: {
  products: SupplierProduct[];
  supplierId: string;
}) {
  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Este fornecedor ainda não possui produtos com oferta ativa.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
            <th className="px-4 py-2">Produto</th>
            <th className="px-4 py-2">Custo</th>
            <th className="px-4 py-2">Estoque</th>
            <th className="px-4 py-2">Prazo</th>
            <th className="px-4 py-2">Sourcing</th>
            <th className="px-4 py-2 text-right">Un. vendidas</th>
            <th className="px-4 py-2 text-right">Faturamento</th>
            <th className="px-4 py-2 text-right">Margem</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.offerId} className="border-b border-brand-line last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2">
                <Link
                  href={`/admin/fornecedores/${supplierId}/produtos/${p.masterProductId}`}
                  className="group flex items-center gap-2"
                >
                  {p.images[0] ? (
                    <img src={p.images[0]} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <div className="size-8 rounded bg-muted" />
                  )}
                  <div>
                    <p className="font-medium text-brand-ink group-hover:text-brand-navy">{p.name}</p>
                    {p.sku && <p className="text-[0.65rem] text-brand-ink-soft">SKU: {p.sku}</p>}
                  </div>
                </Link>
              </td>
              <td className="px-4 py-2 tabular-nums">{p.costCentavos != null ? fmt(p.costCentavos) : "—"}</td>
              <td className="px-4 py-2">
                <span className={cn("tabular-nums", p.stock != null && p.stock <= 0 && "font-semibold text-red-600")}>
                  {p.stock ?? "—"}
                </span>
              </td>
              <td className="px-4 py-2 tabular-nums">{p.leadTimeDays}d</td>
              <td className="px-4 py-2">
                {p.isSourcingAtual ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-green-700">Principal</span>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold text-brand-ink-soft">Alternativa</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{p.unidadesVendidas}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(p.faturamento)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{p.margemGerada !== 0 ? fmt(p.margemGerada) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sales table ───────────────────────────────────────────────────────────

export function SalesTable({
  sales,
  total,
  page,
  perPage,
}: {
  sales: SupplierSale[];
  total: number;
  page: number;
  perPage: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const totalPages = Math.ceil(total / perPage);

  function setPage(p: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (sales.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Este fornecedor ainda não possui vendas atribuídas no período.
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 text-xs text-brand-ink-soft">{total} venda(s) encontrada(s)</div>
      <div className="overflow-x-auto rounded-xl border border-brand-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
              <th className="px-4 py-2">Pedido</th>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Produto</th>
              <th className="px-4 py-2 text-right">Qtd</th>
              <th className="px-4 py-2 text-right">Preço un.</th>
              <th className="px-4 py-2 text-right">Custo un.</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2 text-right">Margem</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={`${s.orderId}-${s.productId}`} className="border-b border-brand-line last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link href={`/admin/pedidos/${s.orderCode}`} className="font-medium text-brand-navy hover:underline">
                    {s.orderCode}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-brand-ink-soft">
                  {new Date(s.orderDate).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-2">{s.productName}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.qty}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(s.unitPriceCentavos)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.supplierCostCentavos != null ? fmt(s.supplierCostCentavos) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(s.lineCentavos)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.margemCentavos != null ? fmt(s.margemCentavos) : "—"}
                </td>
                <td className="px-4 py-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold">{s.orderStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-brand-line px-3 py-1 text-xs font-semibold disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-xs text-brand-ink-soft">
            {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="rounded-lg border border-brand-line px-3 py-1 text-xs font-semibold disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}

// ─── Top products ──────────────────────────────────────────────────────────

export function TopProductsRanking({
  title,
  products,
  supplierId,
}: {
  title: string;
  products: TopProduct[];
  supplierId: string;
}) {
  if (products.length === 0) return null;
  return (
    <div className="rounded-2xl border border-brand-line bg-card">
      <h3 className="border-b border-brand-line px-5 py-3 font-heading text-base font-bold text-brand-navy">
        {title}
      </h3>
      <div className="divide-y divide-brand-line">
        {products.map((p, i) => (
          <Link
            key={p.masterProductId}
            href={`/admin/fornecedores/${supplierId}/produtos/${p.masterProductId}`}
            className="flex items-center gap-3 px-5 py-3 transition hover:bg-muted/30"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-xs font-bold text-brand-navy">
              {i + 1}
            </span>
            {p.images[0] ? (
              <img src={p.images[0]} alt="" className="size-8 rounded object-cover" />
            ) : (
              <div className="size-8 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-ink">{p.productName}</p>
              <p className="text-xs text-brand-ink-soft">
                {p.unidades} un. · {fmt(p.faturamento)} · {p.participacaoPct}%
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-brand-ink-soft" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Performance ───────────────────────────────────────────────────────────

export function PerformanceGrid({ perf }: { perf: SupplierPerformance }) {
  const items: { label: string; value: number; icon: React.ReactNode; tone?: string }[] = [
    { label: "Produto #1 (sourcing atual)", value: perf.produtosRank1, icon: <TrendingUp className="size-4 text-green-600" /> },
    { label: "Alternativa/reserva", value: perf.produtosAlternativa, icon: <ArrowRightLeft className="size-4 text-blue-600" /> },
    { label: "Vezes ganhou sourcing", value: perf.vezesSourcingGanho, icon: <TrendingUp className="size-4 text-green-600" /> },
    { label: "Vezes perdeu sourcing", value: perf.vezesSourcingPerdido, icon: <TrendingDown className="size-4 text-red-600" /> },
    { label: "Auto-switches envolvido", value: perf.autoSwitchesEnvolvido, icon: <Bot className="size-4 text-purple-600" /> },
    { label: "Estoque zero (ativas)", value: perf.estoqueZeroOcorrencias, icon: <AlertTriangle className="size-4 text-amber-600" />, tone: perf.estoqueZeroOcorrencias > 0 ? "text-red-600" : undefined },
    { label: "Exceções abertas", value: perf.excecoesAbertas, icon: <AlertTriangle className="size-4 text-amber-600" />, tone: perf.excecoesAbertas > 0 ? "text-amber-600" : undefined },
    { label: "Alterações de custo", value: perf.alteracoesCusto, icon: <DollarSign className="size-4 text-brand-ink-soft" /> },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 rounded-2xl border border-brand-line bg-card p-4">
          {it.icon}
          <div>
            <p className={cn("font-heading text-xl font-extrabold tabular-nums", it.tone ?? "text-brand-navy")}>{it.value}</p>
            <p className="text-xs text-brand-ink-soft">{it.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Revenue chart (simple bar) ────────────────────────────────────────────

export function RevenueChart({ data }: { data: SupplierRevenuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-8 text-center text-sm text-brand-ink-soft">
        Sem dados de faturamento no período.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.faturamento), 1);

  return (
    <div className="rounded-2xl border border-brand-line bg-card p-5">
      <h3 className="mb-4 font-heading text-base font-bold text-brand-navy">Faturamento ao longo do tempo</h3>
      <div className="flex items-end gap-1" style={{ height: 160 }}>
        {data.map((d) => {
          const h = Math.max((d.faturamento / max) * 140, 2);
          return (
            <div key={d.date} className="group relative flex-1" title={`${d.date}: ${fmt(d.faturamento)}`}>
              <div
                className="mx-auto rounded-t bg-brand-navy/80 transition-colors group-hover:bg-brand-navy"
                style={{ height: h, maxWidth: 32 }}
              />
              <div className="absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-brand-navy px-1.5 py-0.5 text-[0.6rem] text-white group-hover:block">
                {fmt(d.faturamento)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 overflow-hidden">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center text-[0.55rem] text-brand-ink-soft">
            {i % Math.max(1, Math.floor(data.length / 10)) === 0 ? d.date.slice(5) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Catalogs section ──────────────────────────────────────────────────────

function fmtBrl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MATCH_LABELS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-muted text-brand-ink-soft" },
  normalizado: { label: "Normalizado", cls: "bg-blue-100 text-blue-800" },
  match_sugerido: { label: "Match sugerido", cls: "bg-amber-100 text-amber-800" },
  revisao_manual: { label: "Revisão manual", cls: "bg-orange-100 text-orange-800" },
  aprovado: { label: "Aprovado", cls: "bg-green-100 text-green-800" },
  rejeitado: { label: "Rejeitado", cls: "bg-red-100 text-red-700" },
};

function CatalogRow({ catalog, supplierId }: { catalog: SupplierCatalogSummary; supplierId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (items.length > 0) {
      setExpanded(true);
      return;
    }
    startTransition(async () => {
      const result = await fetchCatalogItemsAction(catalog.id);
      setItems(result.items);
      setExpanded(true);
    });
  };

  return (
    <>
      <tr className="border-b border-brand-line last:border-0 hover:bg-muted/30 cursor-pointer" onClick={toggle}>
        <td className="px-4 py-2">
          {pending ? (
            <Loader2 className="inline size-3.5 animate-spin text-brand-ink-soft" />
          ) : expanded ? (
            <ChevronDown className="inline size-3.5 text-brand-ink-soft" />
          ) : (
            <ChevronRight className="inline size-3.5 text-brand-ink-soft" />
          )}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">{new Date(catalog.created_at).toLocaleDateString("pt-BR")}</td>
        <td className="px-4 py-2">{catalog.source_name ?? catalog.source}</td>
        <td className="px-4 py-2 tabular-nums">{catalog.total_items}</td>
        <td className="px-4 py-2 tabular-nums">{catalog.processed}</td>
        <td className="px-4 py-2 tabular-nums">{catalog.errors}</td>
        <td className="px-4 py-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold">{catalog.status}</span>
        </td>
      </tr>
      {expanded && items.length > 0 && (
        <tr>
          <td colSpan={7} className="bg-muted/30 p-0">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-brand-line bg-muted/60 text-left text-[0.6rem] font-bold uppercase tracking-wider text-brand-ink-soft">
                    <th className="px-4 py-1.5">SKU</th>
                    <th className="px-4 py-1.5">Nome</th>
                    <th className="px-4 py-1.5">EAN</th>
                    <th className="px-4 py-1.5">Custo</th>
                    <th className="px-4 py-1.5">Estoque</th>
                    <th className="px-4 py-1.5">Match</th>
                    <th className="px-4 py-1.5">Master</th>
                    <th className="px-4 py-1.5">Oferta</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const badge = MATCH_LABELS[item.matchStatus] ?? { label: item.matchStatus, cls: "bg-muted" };
                    return (
                      <tr key={item.id} className="border-b border-brand-line/50 last:border-0">
                        <td className="px-4 py-1.5 font-mono text-brand-ink-soft">{item.supplierSku ?? "—"}</td>
                        <td className="px-4 py-1.5 max-w-[200px] truncate">{item.name}</td>
                        <td className="px-4 py-1.5 font-mono text-brand-ink-soft">{item.ean ?? "—"}</td>
                        <td className="px-4 py-1.5 tabular-nums">{item.costCentavos != null ? fmtBrl(item.costCentavos) : "—"}</td>
                        <td className="px-4 py-1.5 tabular-nums">{item.stock ?? "—"}</td>
                        <td className="px-4 py-1.5">
                          <span className={cn("rounded px-1 py-0.5 text-[0.55rem] font-bold", badge.cls)}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-1.5 max-w-[180px] truncate">
                          {item.masterProductId ? (
                            <Link
                              href={`/admin/fornecedores/${supplierId}/produtos/${item.masterProductId}`}
                              className="text-brand-navy hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {item.masterProductName ?? item.masterProductId.slice(0, 8)}
                            </Link>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-1.5">
                          {item.offerStatus ? (
                            <span className={cn("rounded px-1 py-0.5 text-[0.55rem] font-bold",
                              item.offerStatus === "ativa" ? "bg-green-100 text-green-800" : "bg-muted text-brand-ink-soft"
                            )}>
                              {item.offerStatus}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function CatalogsSection({
  catalogs,
  supplierId,
}: {
  catalogs: SupplierCatalogSummary[];
  supplierId: string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-heading text-base font-bold text-brand-navy">Catálogos importados</h3>
        <Link
          href={`/admin/fornecedores/${supplierId}/importar`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-navy/90"
        >
          Importar catálogo
        </Link>
      </div>
      {catalogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
          Nenhum catálogo importado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
                <th className="w-8 px-4 py-2" />
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Origem</th>
                <th className="px-4 py-2">Itens</th>
                <th className="px-4 py-2">Processados</th>
                <th className="px-4 py-2">Erros</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {catalogs.map((c) => (
                <CatalogRow key={c.id} catalog={c} supplierId={supplierId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── History timeline ──────────────────────────────────────────────────────

export function HistoryTimeline({ events }: { events: SupplierHistoryEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Nenhum evento de automação registrado para este fornecedor.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id} className="flex gap-3 rounded-xl border border-brand-line bg-card p-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            {e.type === "troca_fornecedor" ? <ArrowRightLeft className="size-4 text-blue-600" /> :
              e.type === "alteracao_preco" ? <DollarSign className="size-4 text-green-600" /> :
              e.type === "excecao_detectada" ? <AlertTriangle className="size-4 text-amber-600" /> :
              <Calendar className="size-4 text-brand-ink-soft" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-ink">{e.title}</p>
            {e.description && <p className="mt-0.5 text-xs text-brand-ink-soft">{e.description}</p>}
            {e.productName && (
              <p className="mt-0.5 text-xs text-brand-ink-soft">Produto: {e.productName}</p>
            )}
          </div>
          <time className="shrink-0 text-[0.65rem] text-brand-ink-soft">
            {new Date(e.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </time>
        </div>
      ))}
    </div>
  );
}

// ─── Data/conditions section ───────────────────────────────────────────────

export function DataSection({
  supplier,
  terms,
}: {
  supplier: AdminSupplier;
  terms: SupplierCommercialTerms | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 font-heading text-base font-bold text-brand-navy">Dados cadastrais</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard label="CNPJ" value={supplier.cnpj ?? "—"} />
          <InfoCard label="Razão social" value={supplier.trade_name ?? "—"} />
          <InfoCard label="Nome fantasia" value={supplier.name} />
          <InfoCard label="Cidade" value={supplier.city ?? "—"} />
          <InfoCard label="UF" value={supplier.state ?? "—"} />
          <InfoCard label="Prazo entrega CD" value={`${supplier.lead_time_days} dia(s) úteis`} />
          <InfoCard label="Contato" value={supplier.contact_name ?? "—"} />
          <InfoCard label="E-mail" value={supplier.contact_email ?? "—"} />
          <InfoCard label="Telefone" value={supplier.contact_phone ?? "—"} />
          <InfoCard label="Status" value={supplier.active ? "Ativo" : "Inativo"} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-heading text-base font-bold text-brand-navy">Condições comerciais</h3>
        {terms ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <InfoCard
              label="Pedido mínimo"
              value={terms.pedido_minimo_tipo === "valor"
                ? `R$ ${terms.pedido_minimo.toFixed(2)}`
                : `${terms.pedido_minimo} un.`}
            />
            <InfoCard
              label="Frete"
              value={terms.frete_tipo === "gratis_acima"
                ? `Grátis acima de R$ ${(terms.frete_gratis_acima ?? 0).toFixed(2)} · Abaixo: R$ ${(terms.frete_valor ?? 0).toFixed(2)}`
                : (terms.frete_valor == null || terms.frete_valor === 0)
                  ? "Frete grátis"
                  : `Fixo R$ ${(terms.frete_valor ?? 0).toFixed(2)}`}
            />
            <InfoCard label="Prazo entrega" value={`${terms.prazo_entrega_cd_dias} dia(s) úteis`} />
            <InfoCard
              label="Dias de pedido"
              value={terms.dias_pedido.map((d) => ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d]).join(", ")}
            />
          </div>
        ) : (
          <p className="text-sm text-brand-ink-soft">Nenhuma condição comercial ativa.</p>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-brand-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}
