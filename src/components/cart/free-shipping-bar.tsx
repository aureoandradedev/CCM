"use client";

import { useShippingConfig } from "@/lib/shipping-context";
import { selectTotals, useCartStore } from "@/lib/cart/store";
import { useShallow } from "zustand/react/shallow";
import { formatBRL } from "@/lib/utils/format";
import { Package } from "lucide-react";

export function FreeShippingBar() {
  const { freeShippingFrom } = useShippingConfig();
  const totals = useCartStore(useShallow(selectTotals));

  if (totals.count === 0) return null;

  const pct = Math.min(100, (totals.subtotal / freeShippingFrom) * 100);
  const reached = totals.subtotal >= freeShippingFrom;

  return (
    <div className="px-5 py-2.5">
      <div className={reached ? "rounded-xl bg-brand-green/10 px-3 py-2" : "rounded-xl bg-brand-yellow-soft px-3 py-2"}>
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Package className="size-3.5 shrink-0" />
          {reached ? (
            <span className="text-brand-green">Frete grátis garantido!</span>
          ) : (
            <span className="text-brand-navy dark:text-foreground">
              Faltam <strong>{formatBRL(freeShippingFrom - totals.subtotal)}</strong> para frete grátis
            </span>
          )}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${reached ? "bg-brand-green" : "bg-brand-yellow-2"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
