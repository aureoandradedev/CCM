"use client";

import { useActionState, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

import { deleteHoliday, saveHoliday, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls, selectCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { HolidayCalendarRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const SCOPE_LABELS: Record<string, string> = {
  national: "Nacional",
  state: "Estadual",
  municipal: "Municipal",
};

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function HolidayCalendarPanel({ holidays }: { holidays: HolidayCalendarRow[] }) {
  const [addState, addAction, addPending] = useActionState<ActionResult, FormData>(saveHoliday, {});
  const [delState, delAction, delPending] = useActionState<ActionResult, FormData>(deleteHoliday, {});
  const [showForm, setShowForm] = useState(false);
  const [scope, setScope] = useState<"national" | "state" | "municipal">("national");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-brand-navy" />
          <span className="text-sm font-semibold text-brand-ink">
            {holidays.length} feriado{holidays.length !== 1 ? "s" : ""} cadastrado{holidays.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="gap-1.5">
          <Plus className="size-3.5" />
          Adicionar
        </Button>
      </div>

      <Feedback state={delState} />

      {holidays.length > 0 && (
        <div className="divide-y divide-brand-line rounded-xl border border-brand-line">
          {holidays.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-brand-ink">{h.name}</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase",
                    h.scope === "national" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                    h.scope === "state" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                  )}>
                    {SCOPE_LABELS[h.scope]}
                  </span>
                  {h.recurring && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6rem] font-bold text-brand-ink-soft">
                      Recorrente
                    </span>
                  )}
                </div>
                <p className="text-xs text-brand-ink-soft">
                  {formatDateBR(h.holiday_date)}
                  {h.state_code ? ` · ${h.state_code}` : ""}
                  {h.city_name ? ` · ${h.city_name}` : ""}
                </p>
              </div>
              <form action={delAction}>
                <input type="hidden" name="id" value={h.id} />
                <Button type="submit" variant="ghost" size="sm" disabled={delPending} className="text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form action={addAction} className="rounded-xl border border-brand-line bg-card p-4 space-y-3">
          <Feedback state={addState} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Escopo">
              <select
                name="scope"
                className={selectCls}
                value={scope}
                onChange={(e) => setScope(e.target.value as "national" | "state" | "municipal")}
              >
                <option value="national">Nacional</option>
                <option value="state">Estadual</option>
                <option value="municipal">Municipal</option>
              </select>
            </Field>
            <Field label="Data">
              <input type="date" name="holiday_date" className={inputCls} required />
            </Field>
            {(scope === "state" || scope === "municipal") && (
              <Field label="Estado (sigla)">
                <input name="state_code" className={inputCls} placeholder="GO" maxLength={2} required />
              </Field>
            )}
            {scope === "municipal" && (
              <Field label="Cidade">
                <input name="city_name" className={inputCls} placeholder="Goiânia" required />
              </Field>
            )}
            <Field label="Nome do feriado">
              <input name="name" className={inputCls} placeholder="Natal" required />
            </Field>
            <Field label="Recorrente">
              <select name="recurring" className={selectCls}>
                <option value="true">Sim (todo ano)</option>
                <option value="false">Não (data específica)</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="navy" size="sm" disabled={addPending}>
              {addPending ? "Salvando..." : "Salvar feriado"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
