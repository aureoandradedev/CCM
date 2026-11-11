"use client";

import { useActionState, useState } from "react";

import { saveCommercialTerms, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls, selectCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { SupplierCommercialTerms } from "@/lib/admin/types";

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

function DaySelect({ initial }: { initial: number[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initial));
  const toggle = (day: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      <input type="hidden" name="dias_pedido" value={[...selected].join(",")} />
      {WEEKDAYS.map((w) => {
        const active = selected.has(w.value);
        return (
          <button
            key={w.value}
            type="button"
            onClick={() => toggle(w.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "border-brand-navy bg-brand-navy text-white"
                : "border-brand-line bg-background text-brand-ink-soft hover:border-brand-navy/40"
            }`}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

function formatReais(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(2).replace(".", ",");
}

const FRETE_LABELS: Record<string, string> = {
  gratis_acima: "Grátis acima de",
  fixo: "Fixo",
};

const WEEKDAY_SHORT: Record<number, string> = {
  0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb",
};

export function CommercialTermsAdmin({
  supplierId,
  terms,
}: {
  supplierId: string;
  terms: SupplierCommercialTerms | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCommercialTerms, {});
  const [freteTipo, setFreteTipo] = useState<"fixo" | "gratis_acima">(terms?.frete_tipo ?? "fixo");

  return (
    <section className="mt-8">
      <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
        Condições comerciais
      </h2>

      {terms ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MiniCard
            label="Pedido mínimo"
            value={
              terms.pedido_minimo_tipo === "valor"
                ? `R$ ${formatReais(terms.pedido_minimo)}`
                : `${terms.pedido_minimo} un.`
            }
          />
          <MiniCard
            label="Frete"
            value={
              terms.frete_tipo === "gratis_acima"
                ? `Grátis acima de R$ ${formatReais(terms.frete_gratis_acima)} · Abaixo: R$ ${formatReais(terms.frete_valor)}`
                : `Fixo R$ ${formatReais(terms.frete_valor)}`
            }
          />
          <MiniCard
            label="Dias de pedido"
            value={(terms.dias_pedido ?? []).map((d) => WEEKDAY_SHORT[d] ?? d).join(", ")}
          />
          <MiniCard label="Prazo de entrega" value={`${terms.prazo_entrega_cd_dias} dia(s) úteis`} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-brand-ink-soft">
          Nenhuma condição comercial ativa. Preencha o formulário abaixo.
        </p>
      )}

      <details className="mt-4 rounded-2xl border border-brand-line bg-card" open={!terms}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-navy dark:text-foreground">
          {terms ? "Editar condições comerciais" : "Definir condições comerciais"}
        </summary>
        <form action={action} className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
          <input type="hidden" name="supplier_id" value={supplierId} />
          <div className="sm:col-span-2">
            <Feedback state={state} />
          </div>

          <Field label="Tipo de pedido mínimo">
            <select name="pedido_minimo_tipo" defaultValue={terms?.pedido_minimo_tipo ?? "valor"} className={selectCls}>
              <option value="valor">Valor (R$)</option>
              <option value="volume">Volume (unidades)</option>
            </select>
          </Field>
          <Field label="Pedido mínimo" hint="Ex: 500,90">
            <input
              name="pedido_minimo"
              defaultValue={formatReais(terms?.pedido_minimo)}
              className={inputCls}
              inputMode="decimal"
              required
            />
          </Field>

          <Field label="Tipo de frete">
            <select
              name="frete_tipo"
              defaultValue={freteTipo}
              className={selectCls}
              onChange={(e) => setFreteTipo(e.target.value as "fixo" | "gratis_acima")}
            >
              <option value="fixo">Fixo</option>
              <option value="gratis_acima">Grátis acima de</option>
            </select>
          </Field>
          <Field label="Valor do frete (R$)" hint="Ex: 60,50">
            <input
              name="frete_valor"
              defaultValue={formatReais(terms?.frete_valor)}
              className={inputCls}
              inputMode="decimal"
            />
          </Field>

          {freteTipo === "gratis_acima" && (
            <Field label="Frete grátis acima de (R$)" hint="Ex: 1000,99">
              <input
                name="frete_gratis_acima"
                defaultValue={formatReais(terms?.frete_gratis_acima)}
                className={inputCls}
                inputMode="decimal"
              />
            </Field>
          )}

          <Field label="Prazo de entrega no CD (dias úteis)">
            <input
              name="prazo_entrega_cd_dias"
              defaultValue={terms?.prazo_entrega_cd_dias ?? 3}
              className={inputCls}
              inputMode="numeric"
              required
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Dias de pedido">
              <DaySelect initial={terms?.dias_pedido ?? [1, 2, 3, 4, 5]} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? "Salvando..." : "Salvar condições comerciais"}
            </Button>
          </div>
        </form>
      </details>
    </section>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-card p-3">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-brand-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}
