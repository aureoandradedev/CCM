"use client";

import { Check, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Product } from "@/types/catalog";
import { Button } from "@/components/ui/button";
import { QtyStepper } from "@/components/product/qty-stepper";
import { useShippingConfig } from "@/lib/shipping-context";
import { useHydrated } from "@/hooks/use-hydrated";
import { selectLineQty, selectTotals, useCartStore } from "@/lib/cart/store";
import { formatBRL } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface AddToCartButtonProps {
  product: Product;
  /** quantidade a adicionar por clique (página do produto usa o stepper próprio) */
  qty?: number;
  size?: "default" | "lg" | "xl";
  /** no card, depois de adicionar vira um stepper inline (Obramax) */
  inlineStepper?: boolean;
  className?: string;
  onAdded?: () => void;
}

export function AddToCartButton({ product, qty = 1, size = "default", inlineStepper = false, className, onAdded }: AddToCartButtonProps) {
  const { freeShippingFrom } = useShippingConfig();
  const hydrated = useHydrated();
  const inCart = useCartStore(selectLineQty(product.id));
  const add = useCartStore((s) => s.add);
  const setQty = useCartStore((s) => s.setQty);
  const open = useCartStore((s) => s.open);
  const [justAdded, setJustAdded] = useState(false);
  const disabled = product.stockStatus === "out";

  const handleAdd = () => {
    add(product, qty);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1400);

    const totals = selectTotals(useCartStore.getState());
    const missing = Math.max(0, freeShippingFrom - totals.subtotal);
    toast.success(`${product.name} no carrinho`, {
      id: `cart-${product.id}`,
      description:
        missing > 0
          ? `Faltam ${formatBRL(missing)} para ganhar frete grátis.`
          : "Você ganhou frete grátis!",
      action: { label: "Ver carrinho", onClick: () => open() },
    });
    onAdded?.();
  };

  if (inlineStepper && hydrated && inCart > 0) {
    return (
      <div className={cn("flex items-center justify-between gap-2", className)}>
        <QtyStepper value={inCart} onChange={(n) => setQty(product.id, n)} allowZero size="md" className="flex-1 [&_input]:flex-1" />
        <Button variant="ghost" size="sm" onClick={() => open()} className="shrink-0 text-brand-navy">
          Ver
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="brand"
      size={size}
      className={cn("w-full", className)}
      onClick={handleAdd}
      disabled={disabled}
      aria-label={`Adicionar ${product.name} ao carrinho`}
    >
      <span className={cn("grid [grid-template-areas:'a'] place-items-center")}>
        <span className={cn("[grid-area:a] inline-flex items-center gap-2 transition-[opacity,filter] duration-200", justAdded && "opacity-0 blur-[2px]")}>
          <ShoppingCart className="size-4" />
          {disabled ? "Indisponível" : "Adicionar"}
        </span>
        <span className={cn("[grid-area:a] inline-flex items-center gap-2 transition-[opacity,filter] duration-200", !justAdded && "opacity-0 blur-[2px]")} aria-hidden={!justAdded}>
          <Check className="size-4" />
          Adicionado
        </span>
      </span>
    </Button>
  );
}
