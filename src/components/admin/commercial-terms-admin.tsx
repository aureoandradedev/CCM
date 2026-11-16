"use client";

import { useActionState, useState } from "react";
import { Pencil, Save, Truck, Package, Gift } from "lucide-react";

import { saveCommercialTerms, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { SupplierCommercialTerms } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

// ── Freight UI type (3 visual options → 2 DB types) ───────────────────────

type FreightUiType = "gratis" | "fixo" | "gratis_acima";

function deriveFreightUi(terms: SupplierCommercialTerms | null): FreightUiType {
  if (!terms) return "fixo";
  if (terms.frete_tipo === "gratis_acima") return "gratis_acima";
  if (terms.frete_tipo === "fixo" && (terms.frete_valor == null || terms.frete_valor === 0)) return "gratis";
  return "fixo";
}

function freightUiToDb(ui: FreightUiType): { frete_tipo: string; frete_valor: string; frete_gratis_acima: string } {
  switch (ui) {
    case "gratis": return { frete_tipo: "fixo", frete_valor: "0", frete_gratis_acima: "" };
    case "fixo": return { frete_tipo: "fixo", frete_valor: "", frete_gratis_acima: "" };
    case "gratis_acima": return { frete_tipo: "gratis_acima", frete_valor: "", frete_gratis_acima: "" };
  }
}

// ── Currency mask ─────────────────────────────────────────────────────────

function maskCurrency(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  const formatted = (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return formatted;
}

function parseCurrencyToNumber(masked: string): number {
  if (!masked) return 0;
  const cleaned = masked.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function formatReais(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatReaisDisplay(v: number | null | undefined): string {
  if (v == null) return "—";
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Weekdays ──────────────────────────────────────────────────────────────

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

const WEEKDAY_SHORT: Record<number, string> = {
  0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb",
};

// ── Freight radio cards ───────────────────────────────────────────────────

const FREIGHT_OPTIONS: { value: FreightUiType; label: string; description: string; icon: typeof Truck }[] = [
  { value: "gratis", label: "Frete grátis", description: "Sem custo de entrega para qualquer pedido", icon: Gift },
  { value: "fixo", label: "Frete fixo", description: "Valor fixo cobrado em todos os pedidos", icon: Truck },
  { value: "gratis_acima", label: "Grátis acima de um valor", description: "Grátis se o pedido atingir o mínimo; fixo abaixo", icon: Package },
];

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
            {active && (
              <div className="absolute right-3 top-3 size-2 rounded-full bg-brand-navy" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Currency input ────────────────────────────────────────────────────────

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

// ── Day picker ────────────────────────────────────────────────────────────

function DaySelect({ selected, onChange }: { selected: Set<number>; onChange: (s: Set<number>) => void }) {
  const toggle = (day: number) => {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {WEEKDAYS.map((w) => {
        const active = selected.has(w.value);
        return (
          <button
            key={w.value}
            type="button"
            onClick={() => toggle(w.value)}
            className={cn(
              "h-9 rounded-lg px-3 text-xs font-semibold transition-colors",
              active
                ? "border border-brand-navy bg-brand-navy text-white"
                : "border border-brand-line bg-background text-brand-ink-soft hover:border-brand-navy/40",
            )}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Summary view (collapsed) ──────────────────────────────────────────────

function TermsSummary({ terms }: { terms: SupplierCommercialTerms }) {
  const freightLabel = (() => {
    if (terms.frete_tipo === "gratis_acima") {
      return `Grátis acima de ${formatReaisDisplay(terms.frete_gratis_acima)} · Abaixo: ${formatReaisDisplay(terms.frete_valor)}`;
    }
    if (terms.frete_valor == null || terms.frete_valor === 0) return "Frete grátis";
    return `Fixo ${formatReaisDisplay(terms.frete_valor)}`;
  })();

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Pedido mínimo"
        value={terms.pedido_minimo_tipo === "valor"
          ? formatReaisDisplay(terms.pedido_minimo)
          : `${terms.pedido_minimo} unidades`}
      />
      <SummaryCard label="Frete" value={freightLabel} />
      <SummaryCard label="Prazo de entrega" value={`${terms.prazo_entrega_cd_dias} dia(s) úteis`} />
      <SummaryCard
        label="Dias de pedido"
        value={(terms.dias_pedido ?? []).sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d] ?? d).join(", ")}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-card p-3">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-brand-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function CommercialTermsAdmin({
  supplierId,
  terms,
}: {
  supplierId: string;
  terms: SupplierCommercialTerms | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCommercialTerms, {});
  const [editing, setEditing] = useState(!terms);

  const [freightUi, setFreightUi] = useState<FreightUiType>(() => deriveFreightUi(terms));
  const [pedidoMinimo, setPedidoMinimo] = useState(() => formatReais(terms?.pedido_minimo));
  const [freteValor, setFreteValor] = useState(() => formatReais(terms?.frete_valor));
  const [freteGratisAcima, setFreteGratisAcima] = useState(() => formatReais(terms?.frete_gratis_acima));
  const [prazo, setPrazo] = useState(String(terms?.prazo_entrega_cd_dias ?? 3));
  const [dias, setDias] = useState<Set<number>>(() => new Set(terms?.dias_pedido ?? [1, 2, 3, 4, 5]));

  const handleFreightChange = (v: FreightUiType) => {
    setFreightUi(v);
    const defaults = freightUiToDb(v);
    if (v === "gratis") {
      setFreteValor("0,00");
      setFreteGratisAcima("");
    } else if (v === "fixo") {
      setFreteGratisAcima("");
    }
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Condições comerciais
        </h2>
        {terms && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
            <Pencil className="size-3.5" />
            Editar condições
          </Button>
        )}
      </div>

      {!terms && !editing && (
        <p className="mt-2 text-sm text-brand-ink-soft">
          Nenhuma condição comercial ativa. Preencha o formulário abaixo.
        </p>
      )}

      {terms && !editing && (
        <div className="mt-3">
          <TermsSummary terms={terms} />
        </div>
      )}

      <Feedback state={state} />

      {editing && (
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
          className="mt-4 space-y-6 rounded-2xl border border-brand-line bg-card p-6"
        >
          <input type="hidden" name="supplier_id" value={supplierId} />
          <input type="hidden" name="pedido_minimo_tipo" value="valor" />
          <input type="hidden" name="dias_pedido" value={[...dias].sort().join(",")} />

          {/* 1. Pedido mínimo */}
          <div>
            <h3 className="mb-1 text-sm font-bold text-brand-navy dark:text-foreground">Pedido mínimo</h3>
            <p className="mb-3 text-xs text-brand-ink-soft">Valor mínimo que o fornecedor aceita por pedido.</p>
            <div className="max-w-xs">
              <CurrencyInput
                name="pedido_minimo"
                value={pedidoMinimo}
                onChange={setPedidoMinimo}
                required
                placeholder="500,00"
              />
            </div>
          </div>

          {/* 2. Frete */}
          <div>
            <h3 className="mb-1 text-sm font-bold text-brand-navy dark:text-foreground">Frete</h3>
            <p className="mb-3 text-xs text-brand-ink-soft">Como o frete é cobrado nos pedidos deste fornecedor.</p>

            <FreightCards selected={freightUi} onChange={handleFreightChange} />

            {freightUi === "fixo" && (
              <div className="mt-4 max-w-xs">
                <Field label="Valor do frete" hint="Cobrado em todos os pedidos.">
                  <CurrencyInput
                    name="frete_valor"
                    value={freteValor}
                    onChange={setFreteValor}
                    required
                    placeholder="60,00"
                  />
                </Field>
              </div>
            )}

            {freightUi === "gratis_acima" && (
              <div className="mt-4 grid max-w-lg gap-4 sm:grid-cols-2">
                <Field label="Grátis acima de" hint="Pedidos com esse valor ou mais não pagam frete.">
                  <CurrencyInput
                    name="frete_gratis_acima"
                    value={freteGratisAcima}
                    onChange={setFreteGratisAcima}
                    required
                    placeholder="1.000,00"
                  />
                </Field>
                <Field label="Valor do frete abaixo" hint="Cobrado quando o pedido não atinge o mínimo.">
                  <CurrencyInput
                    name="frete_valor"
                    value={freteValor}
                    onChange={setFreteValor}
                    required
                    placeholder="60,00"
                  />
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
            <h3 className="mb-1 text-sm font-bold text-brand-navy dark:text-foreground">Prazo de entrega</h3>
            <p className="mb-3 text-xs text-brand-ink-soft">
              Quantos dias úteis o fornecedor leva para entregar no centro de distribuição após o pedido.
            </p>
            <div className="max-w-[180px]">
              <Field label="Dias úteis">
                <input
                  name="prazo_entrega_cd_dias"
                  className={cn(inputCls, "tabular-nums")}
                  type="number"
                  min="1"
                  max="90"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  required
                />
              </Field>
            </div>
          </div>

          {/* 4. Dias de pedido */}
          <div>
            <h3 className="mb-1 text-sm font-bold text-brand-navy dark:text-foreground">Dias de pedido</h3>
            <p className="mb-3 text-xs text-brand-ink-soft">
              Em quais dias da semana o fornecedor aceita receber pedidos. O ciclo de compras usa esses dias para gerar ordens automaticamente.
            </p>
            <DaySelect selected={dias} onChange={setDias} />
          </div>

          {/* 5. Botão salvar */}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="brand" size="lg" disabled={pending || dias.size === 0} className="gap-2">
              <Save className="size-4" />
              {pending ? "Salvando..." : "Salvar condições comerciais"}
            </Button>
            {terms && (
              <Button type="button" variant="outline" size="lg" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
