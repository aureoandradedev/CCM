"use client";

import { useActionState, useState } from "react";
import { Truck, Package, Gift } from "lucide-react";

import { submitSupplierRegistration, type RegistrationActionResult } from "@/app/admin/fornecedores/invite-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

// ── Freight UI type ───────────────────────────────────────────────────────

type FreightUiType = "gratis" | "fixo" | "gratis_acima";

const FREIGHT_OPTIONS: { value: FreightUiType; label: string; description: string; icon: typeof Truck }[] = [
  { value: "gratis", label: "Frete grátis", description: "Sem custo de entrega", icon: Gift },
  { value: "fixo", label: "Frete fixo", description: "Valor fixo por pedido", icon: Truck },
  { value: "gratis_acima", label: "Grátis acima de um valor", description: "Grátis se atingir o mínimo", icon: Package },
];

// ── Currency mask ─────────────────────────────────────────────────────────

function maskCurrency(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Sub-components ────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-brand-ink dark:text-foreground">
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[0.7rem] font-normal text-brand-ink-soft">{hint}</span> : null}
    </label>
  );
}

function CurrencyInput({
  name,
  value,
  onChange,
  required,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-brand-ink-soft">
        R$
      </span>
      <input
        name={name}
        className={cn(inputCls, "pl-10 tabular-nums")}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(maskCurrency(e.target.value))}
        required={required}
        placeholder={placeholder ?? "0,00"}
      />
    </div>
  );
}

function FreightCards({ selected, onChange }: { selected: FreightUiType; onChange: (v: FreightUiType) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {FREIGHT_OPTIONS.map((opt) => {
        const active = selected === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "group relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all",
              active
                ? "border-brand-navy bg-brand-navy/5 ring-1 ring-brand-navy/20"
                : "border-brand-line bg-card hover:border-brand-navy/30",
            )}
          >
            <div className={cn(
              "flex size-9 items-center justify-center rounded-lg transition-colors",
              active ? "bg-brand-navy text-white" : "bg-muted text-brand-ink-soft group-hover:bg-brand-navy/10",
            )}>
              <Icon className="size-4.5" />
            </div>
            <div>
              <p className={cn("text-sm font-semibold", active ? "text-brand-navy" : "text-brand-ink")}>
                {opt.label}
              </p>
              <p className="mt-0.5 text-[0.7rem] leading-tight text-brand-ink-soft">{opt.description}</p>
            </div>
            {active && <div className="absolute right-3 top-3 size-2 rounded-full bg-brand-navy" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────

export function RegistrationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitSupplierRegistration, {} as RegistrationActionResult);
  const [freightUi, setFreightUi] = useState<FreightUiType>("fixo");
  const [diasPedido, setDiasPedido] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pedidoMinimo, setPedidoMinimo] = useState("");
  const [freteValor, setFreteValor] = useState("");
  const [freteGratisAcima, setFreteGratisAcima] = useState("");

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
    <form
      action={(fd) => {
        const realFreteTipo = freightUi === "gratis_acima" ? "gratis_acima" : "fixo";
        fd.set("frete_tipo", realFreteTipo);
        if (freightUi === "gratis") {
          fd.set("frete_valor", "0");
          fd.set("frete_gratis_acima", "");
        }
        action(fd);
      }}
      className="max-w-2xl space-y-8"
    >
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
      <fieldset className="space-y-6">
        <legend className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Condições comerciais</legend>

        {/* 1. Pedido mínimo */}
        <div>
          <p className="mb-1 text-xs font-bold text-brand-ink dark:text-foreground">Pedido mínimo</p>
          <p className="mb-3 text-[0.7rem] text-brand-ink-soft">Valor mínimo que você aceita por pedido.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo">
              <select name="pedido_minimo_tipo" className={inputCls} defaultValue="valor">
                <option value="valor">Valor (R$)</option>
                <option value="volume">Quantidade (unidades)</option>
              </select>
            </Field>
            <Field label="Valor mínimo *">
              <CurrencyInput
                name="pedido_minimo"
                value={pedidoMinimo}
                onChange={setPedidoMinimo}
                required
                placeholder="500,00"
              />
            </Field>
          </div>
        </div>

        {/* 2. Frete */}
        <div>
          <p className="mb-1 text-xs font-bold text-brand-ink dark:text-foreground">Frete</p>
          <p className="mb-3 text-[0.7rem] text-brand-ink-soft">Como o frete é cobrado nos seus pedidos.</p>

          <FreightCards selected={freightUi} onChange={(v) => {
            setFreightUi(v);
            if (v === "gratis") { setFreteValor("0,00"); setFreteGratisAcima(""); }
            else if (v === "fixo") { setFreteGratisAcima(""); }
          }} />

          {freightUi === "fixo" && (
            <div className="mt-4 max-w-xs">
              <Field label="Valor do frete *" hint="Cobrado em todos os pedidos.">
                <CurrencyInput name="frete_valor" value={freteValor} onChange={setFreteValor} required placeholder="60,00" />
              </Field>
            </div>
          )}

          {freightUi === "gratis_acima" && (
            <div className="mt-4 grid max-w-lg gap-4 sm:grid-cols-2">
              <Field label="Grátis acima de *" hint="Pedidos com esse valor ou mais não pagam frete.">
                <CurrencyInput name="frete_gratis_acima" value={freteGratisAcima} onChange={setFreteGratisAcima} required placeholder="1.000,00" />
              </Field>
              <Field label="Valor do frete abaixo *" hint="Cobrado quando o pedido não atinge o mínimo.">
                <CurrencyInput name="frete_valor" value={freteValor} onChange={setFreteValor} required placeholder="60,00" />
              </Field>
            </div>
          )}

          {freightUi === "gratis" && (
            <>
              <input type="hidden" name="frete_valor" value="0" />
              <input type="hidden" name="frete_gratis_acima" value="" />
            </>
          )}
        </div>

        {/* 3. Prazo de entrega */}
        <div>
          <p className="mb-1 text-xs font-bold text-brand-ink dark:text-foreground">Prazo de entrega</p>
          <p className="mb-3 text-[0.7rem] text-brand-ink-soft">
            Quantos dias úteis você leva para entregar após receber o pedido.
          </p>
          <div className="max-w-[180px]">
            <Field label="Dias úteis *">
              <input name="prazo_entrega_cd_dias" required type="number" min="1" className={cn(inputCls, "tabular-nums")} defaultValue="3" />
            </Field>
          </div>
        </div>

        {/* 4. Dias de pedido */}
        <div>
          <p className="mb-1 text-xs font-bold text-brand-ink dark:text-foreground">Dias de pedido</p>
          <p className="mb-3 text-[0.7rem] text-brand-ink-soft">
            Em quais dias da semana você aceita receber pedidos.
          </p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(({ value, label }) => {
              const checked = diasPedido.includes(value);
              return (
                <label key={value} className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  checked
                    ? "border-brand-navy bg-brand-navy text-white"
                    : "border-brand-line bg-background text-brand-ink-soft hover:border-brand-navy/40",
                )}>
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
