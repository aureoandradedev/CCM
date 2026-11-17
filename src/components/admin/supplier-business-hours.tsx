"use client";

import { useActionState, useState } from "react";
import { Clock, Save } from "lucide-react";

import { saveSupplierBusinessHours, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { subtractMinutesFromTime } from "@/lib/supplier-calendar";

const ISO_DAYS = [
  { iso: 1, label: "Segunda" },
  { iso: 2, label: "Terça" },
  { iso: 3, label: "Quarta" },
  { iso: 4, label: "Quinta" },
  { iso: 5, label: "Sexta" },
  { iso: 6, label: "Sábado" },
  { iso: 7, label: "Domingo" },
];

type DayConfig = { enabled: boolean; open: string; close: string };
type WeekConfig = Record<string, DayConfig>;

function initWeek(bh: Record<string, { open: string; close: string }> | null): WeekConfig {
  const week: WeekConfig = {};
  for (const d of ISO_DAYS) {
    const existing = bh?.[String(d.iso)];
    week[String(d.iso)] = existing
      ? { enabled: true, open: existing.open, close: existing.close }
      : { enabled: d.iso <= 5, open: "08:00", close: "17:00" };
  }
  return week;
}

function weekToJson(week: WeekConfig): Record<string, { open: string; close: string }> | null {
  const result: Record<string, { open: string; close: string }> = {};
  let any = false;
  for (const [key, day] of Object.entries(week)) {
    if (day.enabled) {
      result[key] = { open: day.open, close: day.close };
      any = true;
    }
  }
  return any ? result : null;
}

export function SupplierBusinessHours({
  supplierId,
  businessHours,
  leadTimeMinutes,
}: {
  supplierId: string;
  businessHours: Record<string, { open: string; close: string }> | null;
  leadTimeMinutes: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveSupplierBusinessHours, {});
  const [week, setWeek] = useState<WeekConfig>(() => initWeek(businessHours));
  const [lead, setLead] = useState(String(leadTimeMinutes ?? 30));

  const updateDay = (iso: string, patch: Partial<DayConfig>) => {
    setWeek((prev) => ({ ...prev, [iso]: { ...prev[iso], ...patch } }));
  };

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="size-4 text-brand-navy" />
        <h3 className="text-sm font-bold text-brand-navy dark:text-foreground">
          Horários de funcionamento
        </h3>
      </div>

      <Feedback state={state} />

      <form
        action={(fd) => {
          fd.set("supplier_id", supplierId);
          fd.set("business_hours", JSON.stringify(weekToJson(week)));
          fd.set("lead_time_minutes", lead);
          action(fd);
        }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-brand-line divide-y divide-brand-line">
          {ISO_DAYS.map((d) => {
            const day = week[String(d.iso)];
            const leadNum = Number(lead) || 0;
            const effectiveCutoff = day.enabled && day.close
              ? subtractMinutesFromTime(day.close, leadNum)
              : null;

            return (
              <div key={d.iso} className="flex items-center gap-3 px-4 py-2.5">
                <label className="flex items-center gap-2 min-w-[100px]">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(e) => updateDay(String(d.iso), { enabled: e.target.checked })}
                    className="accent-brand-navy"
                  />
                  <span className={cn("text-sm font-medium", day.enabled ? "text-brand-ink" : "text-brand-ink-soft line-through")}>
                    {d.label}
                  </span>
                </label>
                {day.enabled && (
                  <>
                    <input
                      type="time"
                      value={day.open}
                      onChange={(e) => updateDay(String(d.iso), { open: e.target.value })}
                      className={cn(inputCls, "w-28 text-xs")}
                    />
                    <span className="text-xs text-brand-ink-soft">às</span>
                    <input
                      type="time"
                      value={day.close}
                      onChange={(e) => updateDay(String(d.iso), { close: e.target.value })}
                      className={cn(inputCls, "w-28 text-xs")}
                    />
                    {effectiveCutoff && (
                      <span className="text-[0.65rem] text-brand-ink-soft whitespace-nowrap">
                        Cutoff: {effectiveCutoff}
                      </span>
                    )}
                  </>
                )}
                {!day.enabled && (
                  <span className="text-xs text-brand-ink-soft">Fechado</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="max-w-[200px]">
          <Field label="Tempo de processamento (minutos)" hint="Quanto tempo antes de fechar o fornecedor precisa para aceitar pedido.">
            <input
              type="number"
              min="0"
              max="480"
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              className={cn(inputCls, "tabular-nums")}
            />
          </Field>
        </div>

        <Button type="submit" variant="navy" size="sm" disabled={pending} className="gap-1.5">
          <Save className="size-3.5" />
          {pending ? "Salvando..." : "Salvar horários"}
        </Button>
      </form>
    </section>
  );
}
