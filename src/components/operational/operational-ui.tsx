"use client";

import { type ReactNode } from "react";
import { AlertTriangle, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SHIPMENT_STATUS_LABEL } from "@/lib/shipment-lifecycle";

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  aguardando_disponibilidade: "bg-slate-100 text-slate-600",
  preparando: "bg-blue-100 text-blue-700",
  pronto_para_envio: "bg-teal-100 text-teal-700",
  pronto_para_retirada: "bg-teal-100 text-teal-700",
  enviado: "bg-violet-100 text-violet-700",
  entregue: "bg-emerald-100 text-emerald-700",
  cancelado: "bg-gray-100 text-gray-500",
  sent: "bg-amber-100 text-amber-700",
  ready: "bg-blue-100 text-blue-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  atrasado: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  ...SHIPMENT_STATUS_LABEL,
  sent: "Aguardando",
  ready: "Pronto",
  in_progress: "Em conferência",
  completed: "Concluída",
  cancelled: "Cancelada",
  atrasado: "Atrasado",
};

export function OpStatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.7rem] font-semibold leading-none",
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600",
        className,
      )}
    >
      {label ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI                                                                */
/* ------------------------------------------------------------------ */

export function OpKpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger" | "success";
}) {
  const cls = {
    default: "text-brand-navy",
    warn: "text-amber-600",
    danger: "text-red-600",
    success: "text-emerald-600",
  }[tone];

  return (
    <div className="flex flex-col items-center rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.04]">
      <span className={cn("font-heading text-2xl font-bold tabular-nums", cls)}>{value}</span>
      <span className="mt-0.5 text-[0.7rem] font-medium text-gray-500">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

export function OpEmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-white py-16 text-center shadow-sm ring-1 ring-black/[0.04]">
      <div className="text-gray-300">{icon}</div>
      <p className="text-sm font-medium text-gray-400">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Progress                                                           */
/* ------------------------------------------------------------------ */

export function OpProgress({ current, total, className }: { current: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-2.5 flex-1 rounded-full bg-gray-100">
        <div
          className={cn("h-2.5 rounded-full transition-all duration-300", pct === 100 ? "bg-emerald-500" : "bg-brand-navy")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums text-gray-500">{current}/{total}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Search + Filter Pills                                              */
/* ------------------------------------------------------------------ */

interface FilterOption {
  key: string;
  label: string;
  count?: number;
}

export function OpSearchFilter({
  placeholder,
  filters,
  activeFilter,
  onFilterChange,
  searchValue,
  onSearchChange,
}: {
  placeholder: string;
  filters: FilterOption[];
  activeFilter: string;
  onFilterChange: (key: string) => void;
  searchValue: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder={placeholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-11 w-full rounded-xl border-0 bg-white pl-10 pr-4 text-sm shadow-sm ring-1 ring-black/[0.08] outline-none transition-shadow placeholder:text-gray-400 focus:ring-2 focus:ring-brand-navy/30"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              activeFilter === f.key
                ? "bg-brand-navy text-white shadow-sm"
                : "bg-white text-gray-500 ring-1 ring-black/[0.06] hover:bg-gray-50 hover:text-gray-700",
            )}
          >
            {f.label}
            {f.count !== undefined && f.count > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[0.6rem] font-bold",
                  activeFilter === f.key ? "bg-white/20" : "bg-gray-100",
                )}
              >
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm Modal                                                      */
/* ------------------------------------------------------------------ */

export function OpConfirmModal({
  open,
  title,
  description,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
  formContent,
}: {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel: string;
  onConfirm?: () => void;
  onCancel: () => void;
  pending?: boolean;
  formContent?: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading text-lg font-bold text-brand-navy">{title}</h3>
        <p className="mt-2 text-sm text-gray-500">{description}</p>
        {detail && <p className="mt-1 text-sm font-medium text-gray-700">{detail}</p>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-gray-500 ring-1 ring-black/[0.08] transition-colors hover:bg-gray-50"
          >
            Cancelar
          </button>
          {formContent ?? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="flex-1 rounded-xl bg-brand-navy px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="mx-auto size-5 animate-spin" /> : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Late / Due Today helpers                                           */
/* ------------------------------------------------------------------ */

export function daysLate(promisedTo: string | null | undefined): number | null {
  if (!promisedTo) return null;
  const promised = new Date(promisedTo);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  promised.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - promised.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

export function OpLateBadge({ promisedTo }: { promisedTo: string | null | undefined }) {
  const days = daysLate(promisedTo);
  if (days === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[0.65rem] font-bold text-red-700">
      <AlertTriangle className="size-3" />
      {days === 1 ? "1 dia atrasado" : `${days} dias atrasado`}
    </span>
  );
}

export function isDueToday(promisedTo: string | null | undefined): boolean {
  if (!promisedTo) return false;
  const d = new Date(promisedTo);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
