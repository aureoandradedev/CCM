"use client";

import { MapPin, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSavedCep, saveCep } from "@/lib/cep-store";
import { computeItemEstimate } from "@/lib/delivery-promise";
import { formatDate } from "@/lib/orders";
import { useShippingConfig } from "@/lib/shipping-context";
import { formatBRL } from "@/lib/utils/format";
import { maskCEP, onlyDigits } from "@/lib/utils/masks";

interface Props {
  expectedAvailabilityDate?: string;
  stockStatus?: string;
  subtotal: number;
}

export function ShippingEstimate({ expectedAvailabilityDate, stockStatus, subtotal }: Props) {
  const { freeShippingFrom, freeShippingLabel, standardShipping } = useShippingConfig();
  const [cep, setCep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = getSavedCep();
    if (saved) {
      setCep(maskCEP(saved));
      setShowResult(true);
    }
  }, []);

  const estimate = useMemo(
    () => computeItemEstimate({ expectedAvailabilityDate, stockStatus }),
    [expectedAvailabilityDate, stockStatus],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = onlyDigits(cep);
    if (d.length !== 8) {
      setError("Digite os 8 números do CEP.");
      return;
    }
    setError(null);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    saveCep(d);
    setShowResult(true);
    setLoading(false);
  };

  const free = subtotal >= freeShippingFrom;

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
      {showResult ? (
        <ul className="mt-3 divide-y divide-brand-line text-sm" aria-live="polite">
          {estimate.promisable ? (
            <>
              <li className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-semibold text-brand-ink">Entrega pela CCM</p>
                  <p className="text-xs text-brand-ink-soft">
                    Receba entre {formatDate(estimate.deliveryFrom)} e {formatDate(estimate.deliveryTo)}
                  </p>
                </div>
                <span className={free ? "font-bold text-brand-green" : "font-semibold text-brand-ink"}>
                  {free ? "Grátis" : formatBRL(standardShipping)}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-semibold text-brand-ink">Retirar no CD da CCM</p>
                  <p className="text-xs text-brand-ink-soft">
                    Disponível a partir de {formatDate(estimate.availableFrom)}
                  </p>
                </div>
                <span className="font-bold text-brand-green">Grátis</span>
              </li>
            </>
          ) : (
            <li className="py-2">
              <p className="font-semibold text-brand-ink">Disponibilidade a confirmar</p>
              <p className="text-xs text-brand-ink-soft">
                O prazo de entrega será informado após a confirmação do pedido.
              </p>
            </li>
          )}
          {!free ? (
            <li className="pt-2 text-xs text-brand-ink-soft">
              Frete grátis para pedidos a partir de {freeShippingLabel}.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
