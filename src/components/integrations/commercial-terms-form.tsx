"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle, Clock, AlertTriangle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { proposeTerms, type TermsState } from "@/app/fornecedores/actions";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const label = "block text-xs font-semibold text-brand-ink";

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

interface TermsData {
  id?: string;
  pedido_minimo: number;
  frete_tipo: string;
  frete_gratis_acima: number | null;
  frete_valor: number | null;
  dias_pedido: number[];
  prazo_entrega_cd_dias: number;
}

interface Props {
  operational: boolean;
  current: TermsData | null;
  pending: TermsData | null;
}

const initial: TermsState = {};

export function CommercialTermsForm({ operational, current, pending }: Props) {
  const [state, action, isPending] = useActionState(proposeTerms, initial);

  const defaults = current ?? pending;
  const [pedidoMinimo, setPedidoMinimo] = useState(
    defaults ? String(Number(defaults.pedido_minimo)) : "",
  );
  const [prazo, setPrazo] = useState(
    String(defaults?.prazo_entrega_cd_dias ?? 3),
  );
  const [freteTipo, setFreteTipo] = useState(defaults?.frete_tipo ?? "fixo");
  const [freteValor, setFreteValor] = useState(
    defaults?.frete_valor ? String(Number(defaults.frete_valor)) : "",
  );
  const [freteGratisAcima, setFreteGratisAcima] = useState(
    defaults?.frete_gratis_acima ? String(Number(defaults.frete_gratis_acima)) : "",
  );
  const [dias, setDias] = useState<Set<number>>(
    new Set(defaults?.dias_pedido ?? [1, 2, 3, 4, 5]),
  );

  const prevDefaultsId = useRef(defaults?.id);
  useEffect(() => {
    if (defaults && defaults.id !== prevDefaultsId.current) {
      prevDefaultsId.current = defaults.id;
      setPedidoMinimo(String(Number(defaults.pedido_minimo)));
      setPrazo(String(defaults.prazo_entrega_cd_dias));
      setFreteTipo(defaults.frete_tipo);
      setFreteValor(defaults.frete_valor ? String(Number(defaults.frete_valor)) : "");
      setFreteGratisAcima(defaults.frete_gratis_acima ? String(Number(defaults.frete_gratis_acima)) : "");
      setDias(new Set(defaults.dias_pedido));
    }
  }, [defaults]);

  const toggleDia = (d: number) => {
    setDias((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {operational && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-green/30 bg-brand-green-soft px-4 py-3">
          <CheckCircle className="mt-0.5 size-5 shrink-0 text-brand-green" />
          <div>
            <p className="text-sm font-semibold text-brand-green">Operacionalmente ativo</p>
            <p className="text-xs text-brand-ink-soft">
              Suas condições comerciais estão vigentes. Seus produtos participam do ranking de compras.
            </p>
          </div>
        </div>
      )}

      {!operational && !pending && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-yellow" />
          <div>
            <p className="text-sm font-semibold text-brand-navy dark:text-foreground">Condições pendentes</p>
            <p className="text-xs text-brand-ink-soft">
              Seus produtos foram importados, mas ainda não entram no ranking. Preencha as condições abaixo para ativar.
            </p>
          </div>
        </div>
      )}

      {pending && !operational && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-line bg-brand-bg px-4 py-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-brand-navy" />
          <div>
            <p className="text-sm font-semibold text-brand-navy dark:text-foreground">Proposta em análise</p>
            <p className="text-xs text-brand-ink-soft">
              Você já enviou uma proposta. A equipe de compras analisa e ativa quando aprovada.
              Você pode enviar uma nova proposta a qualquer momento — ela substitui a anterior.
            </p>
          </div>
        </div>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">
          {state.ok}
        </p>
      )}

      <form action={action} className="space-y-6 rounded-2xl border border-brand-line bg-card p-6">
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          {operational ? "Propor alteração" : "Preencher condições"}
        </h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className={label}>
            Pedido mínimo (R$)
            <input
              name="pedido_minimo"
              className={cn(input, "mt-1")}
              type="number"
              step="0.01"
              min="0.01"
              value={pedidoMinimo}
              onChange={(e) => setPedidoMinimo(e.target.value)}
              required
            />
          </label>

          <label className={label}>
            Prazo de entrega no CD (dias úteis)
            <input
              name="prazo_entrega_cd_dias"
              className={cn(input, "mt-1")}
              type="number"
              min="1"
              max="90"
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              required
            />
          </label>
        </div>

        <fieldset>
          <legend className={label}>Dias de pedido</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDia(d.value)}
                className={cn(
                  "h-9 rounded-lg px-3 text-sm font-semibold transition-colors",
                  dias.has(d.value)
                    ? "bg-brand-navy text-white"
                    : "border border-brand-line bg-card text-brand-ink-soft hover:border-brand-navy/40",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="dias_pedido" value={[...dias].sort().join(",")} />
        </fieldset>

        <div className="space-y-4">
          <label className={label}>
            Tipo de frete
            <select
              name="frete_tipo"
              className={cn(input, "mt-1")}
              value={freteTipo}
              onChange={(e) => setFreteTipo(e.target.value)}
            >
              <option value="fixo">Frete fixo</option>
              <option value="gratis_acima">Grátis acima de valor + fixo abaixo</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Valor do frete (R$)
              <input
                name="frete_valor"
                className={cn(input, "mt-1")}
                type="number"
                step="0.01"
                min="0"
                value={freteValor}
                onChange={(e) => setFreteValor(e.target.value)}
                required
              />
            </label>

            {freteTipo === "gratis_acima" && (
              <label className={label}>
                Grátis acima de (R$)
                <input
                  name="frete_gratis_acima"
                  className={cn(input, "mt-1")}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={freteGratisAcima}
                  onChange={(e) => setFreteGratisAcima(e.target.value)}
                  required
                />
              </label>
            )}
          </div>
        </div>

        <Button type="submit" variant="brand" size="xl" className="w-full gap-2" disabled={isPending || dias.size === 0}>
          <Send className="size-4" />
          {isPending ? "Enviando..." : operational ? "Enviar proposta de alteração" : "Enviar condições comerciais"}
        </Button>
      </form>
    </div>
  );
}
