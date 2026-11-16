"use client";

import { useActionState } from "react";

import { saveCcmConfig, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls, selectCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { CcmConfig } from "@/lib/admin/types";

const CONFIG_LABELS: Record<string, string> = {
  leftover_ceiling_centavos: "Teto de sobra (centavos)",
  auto_price_enabled: "Preço automático",
  auto_switch_enabled: "Troca automática de fornecedor",
  auto_price_increase_limit_pct: "Limite de aumento automático (%)",
  package_discount_pct: "Desconto caixa fechada (%)",
  horario_corte_ciclo: "Horário de corte do ciclo (HH:MM)",
  feriados: "Feriados (array JSON de datas YYYY-MM-DD)",
};

function formatValue(v: unknown): string {
  if (v === true) return "Ativo";
  if (v === false) return "Desativado";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function CcmConfigsPanel({ configs }: { configs: CcmConfig[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCcmConfig, {});
  return (
    <div className="space-y-4">
      {configs.length > 0 ? (
        <div className="divide-y divide-brand-line rounded-xl border border-brand-line">
          {configs.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <p className="text-sm font-semibold text-brand-ink">
                  {CONFIG_LABELS[c.key] ?? c.key}
                </p>
                <p className="text-xs text-brand-ink-soft">
                  {c.scope !== "global" ? `${c.scope}: ${c.scope_ref ?? ""}` : "Global"}
                </p>
              </div>
              <p className="text-sm font-mono tabular-nums text-brand-navy">{formatValue(c.value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-brand-ink-soft">Nenhuma configuração do CCM encontrada.</p>
      )}

      <details className="rounded-xl border border-brand-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-ink hover:text-brand-navy">
          Editar configuração
        </summary>
        <form action={action} className="grid gap-3 border-t border-brand-line p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Feedback state={state} />
          </div>
          <Field label="Chave">
            <select name="key" className={selectCls}>
              <option value="leftover_ceiling_centavos">Teto de sobra (centavos)</option>
              <option value="auto_price_enabled">Preço automático (true/false)</option>
              <option value="auto_switch_enabled">Troca automática de fornecedor (true/false)</option>
              <option value="auto_price_increase_limit_pct">Limite de aumento automático (%)</option>
              <option value="package_discount_pct">Desconto caixa fechada (%)</option>
              <option value="horario_corte_ciclo">Horário de corte do ciclo (HH:MM)</option>
              <option value="feriados">Feriados (array JSON de datas)</option>
            </select>
          </Field>
          <Field label="Escopo">
            <select name="scope" className={selectCls}>
              <option value="global">Global</option>
              <option value="section">Seção (slug)</option>
              <option value="product">Produto (ID)</option>
            </select>
          </Field>
          <Field label="Ref do escopo" hint="Slug da seção ou ID do produto (vazio para global)">
            <input name="scope_ref" className={inputCls} />
          </Field>
          <Field label="Valor" hint="Número, true/false, ou JSON">
            <input name="value" className={inputCls} required />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="navy" size="sm" disabled={pending}>
              {pending ? "Salvando..." : "Salvar configuração"}
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
