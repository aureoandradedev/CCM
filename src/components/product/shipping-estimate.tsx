"use client";

import { MapPin, Truck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils/format";
import { maskCEP, onlyDigits } from "@/lib/utils/masks";

export const FREE_SHIPPING_FROM = 799;
export const STANDARD_SHIPPING = 49.9;

interface Option {
  label: string;
  eta: string;
  price: number;
}

/**
 * Simulador de frete. Por enquanto a estimativa é local (prazo do fornecedor +
 * transporte); a cotação real vem quando a integração com os fornecedores entrar.
 */
export function ShippingEstimate({ leadTimeDays = 3, subtotal }: { leadTimeDays?: number; subtotal: number }) {
  const [cep, setCep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = onlyDigits(cep);
    if (d.length !== 8) {
      setError("Digite os 8 números do CEP.");
      return;
    }
    setError(null);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 450));
    const free = subtotal >= FREE_SHIPPING_FROM;
    setOptions([
      { label: "Entrega na obra", eta: `${leadTimeDays + 1} a ${leadTimeDays + 3} dias úteis`, price: free ? 0 : STANDARD_SHIPPING },
      { label: "Retirar na loja", eta: `${leadTimeDays} ${leadTimeDays === 1 ? "dia útil" : "dias úteis"}`, price: 0 },
    ]);
    setLoading(false);
  };

  return (
    <div className="rounded-2xl border border-brand-line bg-card p-4">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="cep" className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
            <Truck className="size-3.5" /> Prazo e frete
          </label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand-ink-soft" />
            <input
              id="cep"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="Digite seu CEP"
              value={cep}
              onChange={(e) => setCep(maskCEP(e.target.value))}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "cep-error" : undefined}
              className="h-11 w-full rounded-lg border border-brand-line bg-background pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-brand-red"
            />
          </div>
        </div>
        <Button type="submit" variant="outline-navy" size="lg" disabled={loading}>
          {loading ? "Calculando..." : "Calcular"}
        </Button>
      </form>
      {error ? (
        <p id="cep-error" className="mt-1.5 text-xs font-medium text-brand-red">
          {error}
        </p>
      ) : null}
      {options ? (
        <ul className="mt-3 divide-y divide-brand-line text-sm" aria-live="polite">
          {options.map((o) => (
            <li key={o.label} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-semibold text-brand-ink">{o.label}</p>
                <p className="text-xs text-brand-ink-soft">{o.eta}</p>
              </div>
              <span className={o.price === 0 ? "font-bold text-brand-green" : "font-semibold text-brand-ink"}>{o.price === 0 ? "Grátis" : formatBRL(o.price)}</span>
            </li>
          ))}
          {subtotal < FREE_SHIPPING_FROM ? (
            <li className="pt-2 text-xs text-brand-ink-soft">
              Frete grátis para pedidos a partir de {formatBRL(FREE_SHIPPING_FROM)}.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
