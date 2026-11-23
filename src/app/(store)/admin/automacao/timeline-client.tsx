"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Filter,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import type { AutomacaoEvent, AutomacaoEventType, AutomacaoMode } from "@/lib/admin/automacao-data";

// ─── Event type config ────────────────────────────────────────────────────

const EVENT_CONFIG: Record<AutomacaoEventType, { label: string; icon: typeof Activity; color: string; bg: string }> = {
  troca_fornecedor: { label: "Fornecedor alterado automaticamente", icon: ArrowRightLeft, color: "text-blue-600", bg: "bg-blue-50" },
  alteracao_preco: { label: "Preço atualizado", icon: DollarSign, color: "text-green-600", bg: "bg-green-50" },
  selecao_sourcing: { label: "Fornecedor selecionado", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
  excecao_detectada: { label: "Problema detectado", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
  excecao_resolvida: { label: "Problema resolvido", icon: CheckCircle2, color: "text-teal-600", bg: "bg-teal-50" },
  execucao_orquestrador: { label: "Automação concluída", icon: Bot, color: "text-purple-600", bg: "bg-purple-50" },
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  aplicado: { label: "Aplicado", icon: CheckCircle2, color: "text-green-600" },
  bloqueado: { label: "Bloqueado", icon: ShieldAlert, color: "text-red-600" },
  pendente: { label: "Pendente", icon: Clock, color: "text-amber-600" },
  resolvido: { label: "Resolvido", icon: CheckCircle2, color: "text-teal-600" },
  descartado: { label: "Descartado", icon: XCircle, color: "text-gray-500" },
};

// ─── Filters bar ──────────────────────────────────────────────────────────

interface FiltersBarProps {
  currentType: string;
  currentMode: string;
  currentStatus: string;
  currentPeriod: string;
  currentSearch: string;
}

function buildHref(params: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return `/admin/automacao${qs ? `?${qs}` : ""}`;
}

export function FiltersBar({ currentType, currentMode, currentStatus, currentPeriod, currentSearch }: FiltersBarProps) {
  const [search, setSearch] = useState(currentSearch);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(currentMode || currentStatus || ["selecao_sourcing", "execucao_orquestrador"].includes(currentType)),
  );

  const periods = [
    { value: "hoje", label: "Hoje" },
    { value: "7d", label: "7 dias" },
    { value: "30d", label: "30 dias" },
    { value: "todos", label: "Todos" },
  ];

  const types: { value: string; label: string }[] = [
    { value: "", label: "Tudo" },
    { value: "troca_fornecedor", label: "Trocas de fornecedor" },
    { value: "alteracao_preco", label: "Preços" },
    { value: "excecao_detectada", label: "Problemas" },
  ];

  const advancedTypes: { value: string; label: string }[] = [
    { value: "selecao_sourcing", label: "Seleções de fornecedor" },
    { value: "execucao_orquestrador", label: "Execuções da automação" },
  ];

  const modes: { value: string; label: string }[] = [
    { value: "", label: "Auto + Manual" },
    { value: "automatico", label: "Automático" },
    { value: "manual", label: "Manual" },
  ];

  const statuses: { value: string; label: string }[] = [
    { value: "", label: "Todos" },
    { value: "aplicado", label: "Aplicados" },
    { value: "bloqueado", label: "Bloqueados" },
    { value: "pendente", label: "Pendentes" },
  ];

  const base = { period: currentPeriod, type: currentType, mode: currentMode, status: currentStatus, search: currentSearch };

  return (
    <div className="space-y-3">
      {/* Period chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-brand-ink-soft" />
        {periods.map((p) => (
          <Link
            key={p.value}
            href={buildHref({ ...base, period: p.value })}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-colors ${
              currentPeriod === p.value
                ? "border-brand-navy bg-brand-navy text-white"
                : "border-brand-line bg-card text-brand-ink hover:border-brand-navy/40"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* Type filters (primary) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <Link
              key={t.value}
              href={buildHref({ ...base, type: t.value })}
              className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${
                currentType === t.value
                  ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                  : "border-brand-line text-brand-ink-soft hover:border-brand-navy/30"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-brand-line px-2.5 text-[11px] font-semibold text-brand-ink-soft transition-colors hover:border-brand-navy/30"
        >
          {showAdvanced ? "Menos filtros" : "Mais filtros"}
        </button>
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-2 rounded-lg bg-muted/30 p-2">
          <div className="flex flex-wrap gap-1.5">
            {advancedTypes.map((t) => (
              <Link
                key={t.value}
                href={buildHref({ ...base, type: t.value })}
                className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${
                  currentType === t.value
                    ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                    : "border-brand-line text-brand-ink-soft hover:border-brand-navy/30"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <span className="hidden text-brand-line sm:block">|</span>
          <div className="flex gap-1.5">
            {modes.map((m) => (
              <Link
                key={m.value}
                href={buildHref({ ...base, mode: m.value })}
                className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${
                  currentMode === m.value
                    ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                    : "border-brand-line text-brand-ink-soft hover:border-brand-navy/30"
                }`}
              >
                {m.label}
              </Link>
            ))}
          </div>
          <span className="hidden text-brand-line sm:block">|</span>
          <div className="flex gap-1.5">
            {statuses.map((s) => (
              <Link
                key={s.value}
                href={buildHref({ ...base, status: s.value })}
                className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11px] font-semibold transition-colors ${
                  currentStatus === s.value
                    ? "border-brand-navy bg-brand-navy/10 text-brand-navy"
                    : "border-brand-line text-brand-ink-soft hover:border-brand-navy/30"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <form action="/admin/automacao" className="flex gap-2">
        <input type="hidden" name="period" value={currentPeriod} />
        {currentType && <input type="hidden" name="type" value={currentType} />}
        {currentMode && <input type="hidden" name="mode" value={currentMode} />}
        {currentStatus && <input type="hidden" name="status" value={currentStatus} />}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input
            type="text"
            name="search"
            placeholder="Buscar produto, fornecedor, motivo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-brand-line bg-background pl-9 pr-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90"
        >
          Buscar
        </button>
      </form>
    </div>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────

function EventCard({ event }: { event: AutomacaoEvent }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = EVENT_CONFIG[event.type];
  const Icon = cfg.icon;
  const statusCfg = STATUS_CONFIG[event.status] ?? STATUS_CONFIG.aplicado;
  const StatusIcon = statusCfg.icon;

  const ts = new Date(event.timestamp);
  const dateStr = ts.toLocaleDateString("pt-BR");
  const timeStr = ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="group relative flex gap-3 rounded-xl border border-brand-line bg-card p-4 transition-shadow hover:shadow-sm">
      {/* Icon */}
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
        <Icon className={`size-5 ${cfg.color}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCfg.color}`}>
                <StatusIcon className="size-3" />
                {statusCfg.label}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                event.mode === "automatico"
                  ? "bg-purple-50 text-purple-700"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {event.mode === "automatico" ? "Automático" : "Manual"}
              </span>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-brand-ink">{event.title}</h3>
            <p className="mt-0.5 text-xs text-brand-ink-soft">{event.description}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-brand-ink-soft">
            <div>{dateStr}</div>
            <div>{timeStr}</div>
          </div>
        </div>

        {/* Key info */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
          {event.productName && (
            <span>
              <span className="font-semibold text-brand-ink">Produto:</span> {event.productName}
            </span>
          )}
          {event.reason && (
            <span>
              <span className="font-semibold text-brand-ink">Motivo:</span> {event.reason}
            </span>
          )}
          {event.supplierOld && event.supplierNew && (
            <span>
              <span className="font-semibold text-brand-ink">Fornecedor:</span> {event.supplierOld} → {event.supplierNew}
            </span>
          )}
          {event.supplierNew && !event.supplierOld && (
            <span>
              <span className="font-semibold text-brand-ink">Fornecedor:</span> {event.supplierNew}
            </span>
          )}
          {event.changePct != null && (
            <span>
              <span className="font-semibold text-brand-ink">Variação:</span>{" "}
              <span className={event.changePct > 0 ? "text-red-600" : event.changePct < 0 ? "text-green-600" : ""}>
                {event.changePct > 0 ? "+" : ""}
                {event.changePct.toFixed(1)}%
              </span>
            </span>
          )}
          {event.severity && (
            <span>
              <span className="font-semibold text-brand-ink">Severidade:</span>{" "}
              <span className={
                event.severity === "critical" ? "font-bold text-red-600" :
                event.severity === "high" ? "text-red-500" :
                event.severity === "medium" ? "text-amber-600" :
                "text-gray-500"
              }>
                {event.severity === "critical" ? "Crítica" :
                 event.severity === "high" ? "Alta" :
                 event.severity === "medium" ? "Média" : "Baixa"}
              </span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-2 flex items-center gap-2">
          {event.masterProductId && (
            <Link
              href={`/admin/automacao/produto/${event.masterProductId}`}
              className="text-xs font-semibold text-brand-navy hover:underline"
            >
              Abrir produto
            </Link>
          )}
          {event.type === "excecao_detectada" && event.status === "pendente" && (
            <Link
              href={`/admin/compras/pendencias`}
              className="text-xs font-semibold text-amber-600 hover:underline"
            >
              Abrir pendência
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-auto flex items-center gap-1 text-xs text-brand-ink-soft hover:text-brand-ink"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? "Ocultar detalhes" : "Ver detalhes técnicos"}
          </button>
        </div>

        {/* Expandable detail */}
        {expanded && (
          <div className="mt-3 rounded-lg bg-brand-bg/60 p-3 text-xs">
            <p className="mb-1 font-semibold text-brand-ink-soft">Detalhes técnicos</p>
            {event.reasonCode && (
              <p><span className="font-medium">Código:</span> <code className="rounded bg-brand-line px-1">{event.reasonCode}</code></p>
            )}
            {event.priceOld != null && (
              <p><span className="font-medium">Custo anterior:</span> R$ {(event.priceOld / 100).toFixed(2).replace(".", ",")}</p>
            )}
            {event.priceNew != null && (
              <p><span className="font-medium">Custo novo:</span> R$ {(event.priceNew / 100).toFixed(2).replace(".", ",")}</p>
            )}
            {event.masterProductId && (
              <p><span className="font-medium">Master ID:</span> <code className="rounded bg-brand-line px-1 text-[10px]">{event.masterProductId}</code></p>
            )}
            {Object.keys(event.detail).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium text-brand-ink-soft hover:text-brand-ink">JSON completo</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-brand-ink-soft">
                  {JSON.stringify(event.detail, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────

export function Timeline({ events, total, page, perPage, baseParams }: {
  events: AutomacaoEvent[];
  total: number;
  page: number;
  perPage: number;
  baseParams: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Nenhum evento encontrado para os filtros selecionados.
      </div>
    );
  }

  let lastDate = "";

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const eventDate = new Date(event.timestamp).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
        const showDateHeader = eventDate !== lastDate;
        lastDate = eventDate;
        return (
          <div key={event.id}>
            {showDateHeader && (
              <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-brand-ink-soft first:mt-0">{eventDate}</p>
            )}
            <EventCard event={event} />
          </div>
        );
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 text-sm text-brand-ink-soft">
          <span>
            Página {page} de {totalPages} · {total} evento(s)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref({ ...baseParams, page: String(page - 1) })}
                className="inline-flex h-8 items-center rounded-full border border-brand-line bg-card px-3 text-xs font-semibold text-brand-ink hover:border-brand-navy/40"
              >
                Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildHref({ ...baseParams, page: String(page + 1) })}
                className="inline-flex h-8 items-center rounded-full border border-brand-line bg-card px-3 text-xs font-semibold text-brand-ink hover:border-brand-navy/40"
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
