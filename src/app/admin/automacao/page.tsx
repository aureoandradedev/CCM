import Link from "next/link";
import { Activity, AlertTriangle, ArrowRightLeft, Bot, DollarSign } from "lucide-react";

import { Kpi, PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { getAutomacaoKpis, getAutomacaoTimeline, type AutomacaoEventType, type AutomacaoFilters, type AutomacaoMode } from "@/lib/admin/automacao-data";

import { FiltersBar, Timeline } from "./timeline-client";

export default async function AutomacaoPage(props: {
  searchParams: Promise<{
    period?: string;
    type?: string;
    mode?: string;
    status?: string;
    search?: string;
    page?: string;
  }>;
}) {
  if (!configured()) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Banco de dados não configurado.
      </div>
    );
  }

  const sp = await props.searchParams;
  const period = sp.period || "30d";
  const type = (sp.type || "") as AutomacaoEventType | "";
  const mode = (sp.mode || "") as AutomacaoMode | "";
  const status = sp.status || "";
  const search = sp.search || "";
  const page = Number(sp.page) || 1;
  const perPage = 50;

  const filters: AutomacaoFilters = {
    period: period as AutomacaoFilters["period"],
    type: type || undefined,
    mode: mode || undefined,
    status: status || undefined,
    search: search || undefined,
    page,
    perPage,
  };

  const [kpis, timeline] = await Promise.all([
    getAutomacaoKpis(),
    getAutomacaoTimeline(filters),
  ]);

  const lastRunStr = kpis.ultimaExecucao
    ? new Date(kpis.ultimaExecucao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Nunca executou";

  const lastRunStatusLabel = kpis.ultimaExecucaoStatus === "completed"
    ? "Sucesso"
    : kpis.ultimaExecucaoStatus === "partial"
    ? "Parcial"
    : kpis.ultimaExecucaoStatus === "failed"
    ? "Falhou"
    : "—";

  const baseParams: Record<string, string> = {};
  if (period) baseParams.period = period;
  if (type) baseParams.type = type;
  if (mode) baseParams.mode = mode;
  if (status) baseParams.status = status;
  if (search) baseParams.search = search;

  return (
    <>
      <PageTitle title="Automação" subtitle="Acompanhe as ações automáticas e manuais no fluxo de compras">
        <Link
          href="/admin/compras/automacao"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand-line bg-card px-3 text-xs font-semibold text-brand-ink transition-colors hover:border-brand-navy/40"
        >
          <AlertTriangle className="size-4 text-amber-600" />
          Exceções abertas ({kpis.excecoesAbertas})
        </Link>
      </PageTitle>

      {/* KPI summary */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Ações automáticas (7d)"
          value={String(kpis.totalEventos7d)}
          tone={kpis.totalEventos7d > 0 ? "navy" : "slate"}
          hint="Trocas + preços automáticos"
        />
        <div className="rounded-2xl border border-brand-line bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">Trocas automáticas</p>
          <p className="mt-1 flex items-center gap-2 font-heading text-2xl font-extrabold tabular-nums text-blue-600">
            <ArrowRightLeft className="size-5" /> {kpis.trocasAuto7d}
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">nos últimos 7 dias</p>
        </div>
        <div className="rounded-2xl border border-brand-line bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">Preços automáticos</p>
          <p className="mt-1 flex items-center gap-2 font-heading text-2xl font-extrabold tabular-nums text-green-600">
            <DollarSign className="size-5" /> {kpis.precosAuto7d}
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">nos últimos 7 dias</p>
        </div>
        <Kpi
          label="Exceções abertas"
          value={String(kpis.excecoesAbertas)}
          tone={kpis.excecoesAbertas > 0 ? "yellow" : "green"}
          hint="Requerem atenção"
        />
        <div className="rounded-2xl border border-brand-line bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">Última execução</p>
          <p className="mt-1 flex items-center gap-2 font-heading text-sm font-extrabold tabular-nums text-brand-navy">
            <Bot className="size-5" />
            <span className={
              kpis.ultimaExecucaoStatus === "completed" ? "text-green-600" :
              kpis.ultimaExecucaoStatus === "partial" ? "text-amber-600" :
              kpis.ultimaExecucaoStatus === "failed" ? "text-red-600" : ""
            }>
              {lastRunStatusLabel}
            </span>
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">{lastRunStr}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <FiltersBar
          currentType={type}
          currentMode={mode}
          currentStatus={status}
          currentPeriod={period}
          currentSearch={search}
        />
      </div>

      {/* Timeline count */}
      <div className="mb-3 flex items-center gap-2 text-sm text-brand-ink-soft">
        <Activity className="size-4" />
        <span>
          {timeline.total} evento(s) encontrado(s)
          {period !== "todos" && ` nos últimos ${period === "hoje" ? "dia" : period === "7d" ? "7 dias" : "30 dias"}`}
        </span>
      </div>

      {/* Timeline feed */}
      <Timeline
        events={timeline.events}
        total={timeline.total}
        page={page}
        perPage={perPage}
        baseParams={baseParams}
      />
    </>
  );
}
