"use client";

import { useState, useTransition } from "react";
import type { SupplierOperationalKpis } from "@/lib/supplier-performance";

const PERIODS = [
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "todos", label: "Todos" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

function Stat({ label, value, suffix }: { label: string; value: string | number | null; suffix?: string }) {
  const display = value === null ? "—" : typeof value === "number" ? `${value}${suffix ?? ""}` : value;
  return (
    <div className="rounded-lg border border-brand-line bg-card p-3">
      <p className="text-xs font-medium text-brand-ink-soft">{label}</p>
      <p className="mt-1 text-lg font-bold text-brand-ink">{display}</p>
    </div>
  );
}

export function SupplierKpiPanel({
  initialKpis,
  supplierId,
  fetchKpis,
}: {
  initialKpis: SupplierOperationalKpis | null;
  supplierId: string;
  fetchKpis: (supplierId: string, period: PeriodKey) => Promise<SupplierOperationalKpis | null>;
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [kpis, setKpis] = useState(initialKpis);
  const [isPending, startTransition] = useTransition();

  function changePeriod(p: PeriodKey) {
    setPeriod(p);
    startTransition(async () => {
      const result = await fetchKpis(supplierId, p);
      setKpis(result);
    });
  }

  if (!kpis || kpis.totalEvents === 0) {
    return (
      <div className="rounded-xl border border-brand-line bg-card p-6">
        <h3 className="font-heading text-base font-bold text-brand-navy">Indicadores operacionais</h3>
        <div className="mt-2 flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => changePeriod(p.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                period === p.key ? "bg-brand-navy text-white" : "border border-brand-line text-brand-ink-soft hover:bg-brand-line/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm text-brand-ink-soft">Sem dados suficientes para o período selecionado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-line bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-bold text-brand-navy">Indicadores operacionais</h3>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => changePeriod(p.key)}
              disabled={isPending}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                period === p.key ? "bg-brand-navy text-white" : "border border-brand-line text-brand-ink-soft hover:bg-brand-line/50"
              } disabled:opacity-50`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="POs enviados" value={kpis.posSent} />
        <Stat label="POs confirmados" value={kpis.posConfirmed} />
        <Stat label="Taxa de confirmação" value={kpis.confirmationRate} suffix="%" />
        <Stat label="Tempo médio confirmação" value={kpis.avgConfirmationHours} suffix="h" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Entregas pontuais" value={kpis.deliveriesOnTime} />
        <Stat label="Entregas atrasadas" value={kpis.deliveriesLate} />
        <Stat label="Pontualidade" value={kpis.onTimeRate} suffix="%" />
        <Stat label="Cortados do ciclo" value={kpis.cutFromCycle} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Recebimento perfeito" value={kpis.receivingsFullMatch} />
        <Stat label="Taxa de falta" value={kpis.shortageRate} suffix="%" />
        <Stat label="Taxa de excesso" value={kpis.excessRate} suffix="%" />
        <Stat label="Taxa de avaria" value={kpis.damageRate} suffix="%" />
        <Stat label="Taxa de troca" value={kpis.swapRate} suffix="%" />
      </div>

      <p className="mt-3 text-xs text-brand-ink-soft">
        {kpis.totalEvents} evento(s) no período. Dados observacionais — nenhuma ação automática.
      </p>
    </div>
  );
}
