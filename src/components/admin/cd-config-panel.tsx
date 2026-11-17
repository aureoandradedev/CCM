"use client";

import { useActionState, useState } from "react";
import { Building2, Save } from "lucide-react";

import { saveCdConfig, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CdConfigPanel({ city, state }: { city: string | null; state: string | null }) {
  const [result, action, pending] = useActionState<ActionResult, FormData>(saveCdConfig, {});
  const [cdCity, setCdCity] = useState(city ?? "");
  const [cdState, setCdState] = useState(state ?? "");

  const configured = Boolean(city && state);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="size-4 text-brand-navy" />
        <span className="text-sm font-semibold text-brand-ink">Centro de Distribuição</span>
      </div>

      {!configured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Cidade e estado do CD não configurados. Configure para cálculo correto de feriados e prazos.
        </p>
      )}

      <Feedback state={result} />

      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <Field label="Estado (sigla)" hint="Ex: GO">
          <input
            name="cd_state"
            className={cn(inputCls, "uppercase")}
            value={cdState}
            onChange={(e) => setCdState(e.target.value.toUpperCase())}
            maxLength={2}
            placeholder="GO"
          />
        </Field>
        <Field label="Cidade" hint="Nome da cidade do CD">
          <input
            name="cd_city"
            className={inputCls}
            value={cdCity}
            onChange={(e) => setCdCity(e.target.value)}
            placeholder="Goiânia"
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="navy" size="sm" disabled={pending} className="gap-1.5">
            <Save className="size-3.5" />
            {pending ? "Salvando..." : "Salvar configuração do CD"}
          </Button>
        </div>
      </form>
    </div>
  );
}
