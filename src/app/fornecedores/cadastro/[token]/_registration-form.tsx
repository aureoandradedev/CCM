"use client";

import { useActionState, useState } from "react";

import { submitSupplierRegistration, type RegistrationActionResult } from "@/app/admin/fornecedores/invite-actions";
import { Button } from "@/components/ui/button";

const inputCls =
  "h-10 w-full rounded-lg border border-brand-line bg-background px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-brand-ink dark:text-foreground">
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[0.7rem] font-normal text-brand-ink-soft">{hint}</span> : null}
    </label>
  );
}

export function RegistrationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitSupplierRegistration, {} as RegistrationActionResult);
  const [freteTipo, setFreteTipo] = useState("fixo");
  const [diasPedido, setDiasPedido] = useState<number[]>([1, 2, 3, 4, 5]);

  if (state.ok) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-brand-line bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <svg className="size-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="font-heading text-xl font-bold text-brand-navy dark:text-foreground">Cadastro enviado!</h2>
        <p className="mt-2 text-sm text-brand-ink-soft">{state.ok}</p>
      </div>
    );
  }

  return (
    <form action={action} className="max-w-2xl space-y-8">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">{state.error}</p>
      ) : null}

      {/* Dados cadastrais */}
      <fieldset className="space-y-4">
        <legend className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Dados da empresa</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome fantasia *">
            <input name="name" required minLength={2} className={inputCls} placeholder="Ex.: Quartzolit" />
          </Field>
          <Field label="Razão social *">
            <input name="trade_name" required minLength={3} className={inputCls} placeholder="Ex.: Saint-Gobain do Brasil Ltda." />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="CNPJ">
            <input name="cnpj" className={inputCls} placeholder="00.000.000/0001-00" />
          </Field>
          <Field label="Estado">
            <select name="state" className={inputCls}>
              <option value="">Selecione...</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Cidade">
            <input name="city" className={inputCls} placeholder="Ex.: São Paulo" />
          </Field>
        </div>
      </fieldset>

      {/* Contato */}
      <fieldset className="space-y-4">
        <legend className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Contato</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nome do contato *">
            <input name="contact_name" required minLength={2} className={inputCls} placeholder="Ex.: João Silva" />
          </Field>
          <Field label="E-mail">
            <input name="contact_email" type="email" className={inputCls} placeholder="comercial@empresa.com" />
          </Field>
          <Field label="Telefone">
            <input name="contact_phone" className={inputCls} placeholder="(11) 99999-0000" />
          </Field>
        </div>
      </fieldset>

      {/* Condições comerciais */}
      <fieldset className="space-y-4">
        <legend className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Condições comerciais</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de pedido mínimo">
            <select name="pedido_minimo_tipo" className={inputCls} defaultValue="valor">
              <option value="valor">Valor (R$)</option>
              <option value="volume">Volume (quantidade)</option>
            </select>
          </Field>
          <Field label="Pedido mínimo *">
            <input name="pedido_minimo" required type="number" step="0.01" min="0" className={inputCls} placeholder="Ex.: 500.00" />
          </Field>
        </div>

        <Field label="Dias de pedido *" hint="Selecione os dias da semana em que aceita pedidos.">
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map(({ value, label }) => {
              const checked = diasPedido.includes(value);
              return (
                <label key={value} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${checked ? "border-brand-navy bg-brand-navy text-white" : "border-brand-line bg-background text-brand-ink-soft hover:border-brand-navy/40"}`}>
                  <input
                    type="checkbox"
                    name="dias_pedido"
                    value={value}
                    checked={checked}
                    onChange={(e) => {
                      if (e.target.checked) setDiasPedido((p) => [...p, value]);
                      else setDiasPedido((p) => p.filter((d) => d !== value));
                    }}
                    className="sr-only"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prazo de entrega (dias úteis) *">
            <input name="prazo_entrega_cd_dias" required type="number" min="1" className={inputCls} defaultValue="3" />
          </Field>
          <Field label="Tipo de frete">
            <select
              name="frete_tipo"
              className={inputCls}
              value={freteTipo}
              onChange={(e) => setFreteTipo(e.target.value)}
            >
              <option value="fixo">Frete fixo</option>
              <option value="gratis_acima">Grátis acima de valor</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {freteTipo === "gratis_acima" ? (
            <Field label="Frete grátis acima de (R$)">
              <input name="frete_gratis_acima" type="number" step="0.01" min="0" className={inputCls} placeholder="Ex.: 1000.00" />
            </Field>
          ) : null}
          <Field label="Valor do frete (R$)">
            <input name="frete_valor" type="number" step="0.01" min="0" className={inputCls} placeholder="Ex.: 50.00" />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="navy" size="lg" disabled={pending}>
          {pending ? "Enviando..." : "Enviar cadastro"}
        </Button>
      </div>
    </form>
  );
}
