"use client";

import { ShoppingCart } from "lucide-react";

import { useHydrated } from "@/hooks/use-hydrated";
import { selectCount, useCartStore } from "@/lib/cart/store";
import { cn } from "@/lib/utils";

export function CartButton({ className, showLabel = true }: { className?: string; showLabel?: boolean }) {
  const hydrated = useHydrated();
  const count = useCartStore(selectCount);
  const open = useCartStore((s) => s.open);
  const n = hydrated ? count : 0;

  return (
    <button
      type="button"
      onClick={() => open()}
      className={cn(
        "press relative inline-flex h-11 items-center gap-2 rounded-xl px-3 text-brand-navy transition-colors hover:bg-brand-yellow-soft dark:text-foreground dark:hover:bg-muted",
        className,
      )}
      aria-label={`Abrir carrinho, ${n} ${n === 1 ? "item" : "itens"}`}
    >
      <span className="relative">
        <ShoppingCart className="size-6" strokeWidth={2.2} />
        {n > 0 ? (
          <span
            key={n}
            className="absolute -top-2 -right-2.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-yellow px-1 font-heading text-[0.7rem] font-extrabold text-brand-navy animate-in zoom-in-75 duration-200"
          >
            {n > 99 ? "99+" : n}
          </span>
        ) : null}
      </span>
      {showLabel ? (
        <span className="hidden flex-col items-start leading-none lg:flex">
          <span className="text-[0.68rem] text-brand-ink-soft">Carrinho</span>
          <span className="text-sm font-bold">{n ? `${n} ${n === 1 ? "item" : "itens"}` : "Vazio"}</span>
        </span>
      ) : null}
    </button>
  );
}
