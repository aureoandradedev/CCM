"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { fetchCurrentPrices, type CurrentPrice } from "@/app/carrinho/actions";
import { selectLines, useCartStore, type CartLine } from "@/lib/cart/store";
import { useShallow } from "zustand/react/shallow";
import { formatBRL } from "@/lib/utils/format";
import { useHydrated } from "@/hooks/use-hydrated";

interface PriceChange {
  productId: string;
  name: string;
  oldRetail: number;
  newRetail: number;
}

function detectChanges(lines: CartLine[], current: Record<string, CurrentPrice>): PriceChange[] {
  const changes: PriceChange[] = [];
  for (const line of lines) {
    const cur = current[line.productId];
    if (!cur) continue;
    if (cur.retailPrice !== line.retailPrice) {
      changes.push({
        productId: line.productId,
        name: line.name,
        oldRetail: line.retailPrice,
        newRetail: cur.retailPrice,
      });
    }
  }
  return changes;
}

export function PriceChangeAlert() {
  const hydrated = useHydrated();
  const lines = useCartStore(useShallow(selectLines));
  const [changes, setChanges] = useState<PriceChange[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!hydrated || lines.length === 0) {
      setChanges([]);
      return;
    }
    let cancelled = false;
    const ids = lines.map((l) => l.productId);
    fetchCurrentPrices(ids).then((current) => {
      if (cancelled) return;
      setChanges(detectChanges(lines, current));
    });
    return () => { cancelled = true; };
  }, [hydrated, lines]);

  if (dismissed || changes.length === 0) return null;

  return (
    <div className="rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-orange" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-orange">
            {changes.length === 1 ? "Preço alterado" : `${changes.length} preços alterados`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {changes.map((c) => {
              const diff = c.newRetail - c.oldRetail;
              return (
                <li key={c.productId} className="text-xs text-brand-ink-soft">
                  <span className="font-medium text-brand-ink">{c.name}</span>:{" "}
                  <span className="line-through">{formatBRL(c.oldRetail)}</span>{" "}
                  <span className={diff > 0 ? "font-semibold text-brand-red" : "font-semibold text-brand-green"}>
                    {formatBRL(c.newRetail)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-brand-ink-soft">
            Preços são atualizados no fechamento do pedido.
          </p>
        </div>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-xs text-brand-ink-soft hover:text-brand-ink">
          Fechar
        </button>
      </div>
    </div>
  );
}
