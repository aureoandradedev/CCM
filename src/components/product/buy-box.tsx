"use client";

import { Headset, RotateCcw, ShieldCheck, ShoppingCart, Store } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Product } from "@/types/catalog";
import { CutoffHint } from "@/components/product/cutoff-hint";
import { PriceBlock } from "@/components/product/price-block";
import { QtyStepper } from "@/components/product/qty-stepper";
import { SaleModeInfo } from "@/components/product/sale-mode-info";
import { ShippingEstimate } from "@/components/product/shipping-estimate";
import { Button } from "@/components/ui/button";
import { WhatsappIcon } from "@/components/ui/social-icons";
import { useShippingConfig } from "@/lib/shipping-context";
import { selectTotals, useCartStore } from "@/lib/cart/store";
import { lineTotal, unitPriceFor } from "@/lib/pricing";
import { whatsappLink } from "@/lib/site";
import { formatBRL, formatUnit } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/** Caixa de compra da página do produto: preço, quantidade, CTA, frete e fornecedor. */
export function BuyBox({ product }: { product: Product }) {
  const { freeShippingFrom } = useShippingConfig();
  const [qty, setQty] = useState(1);
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);

  const unit = unitPriceFor(product, qty);
  const total = lineTotal(product, qty);
  const out = product.stockStatus === "out" || product.saleMode === "nao_vender";
  const u = formatUnit(product.unit);

  const handleAdd = () => {
    add(product, qty);
    const cartTotals = selectTotals(useCartStore.getState());
    const missingForFree = Math.max(0, freeShippingFrom - cartTotals.subtotal);
    toast.success(`${qty} ${u} de ${product.name} no carrinho`, {
      id: `cart-${product.id}`,
      description: missingForFree > 0
        ? `Faltam ${formatBRL(missingForFree)} para ganhar frete grátis.`
        : "Você ganhou frete grátis!",
      action: { label: "Ver carrinho", onClick: () => open() },
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-brand-line bg-card p-5 shadow-[var(--shadow-card)]">
        <PriceBlock
          variant="detail"
          unit={product.unit}
          retailPrice={product.retailPrice}
          wholesalePrice={product.wholesalePrice}
          wholesaleMinQty={product.wholesaleMinQty}
          listPrice={product.listPrice}
          pixDiscountPct={product.pixDiscountPct}
        />

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Quantidade ({u})</p>
            <QtyStepper value={qty} onChange={setQty} size="lg" />
          </div>
          <div className="text-right">
            <p className="text-xs text-brand-ink-soft">Total para {qty} {u}</p>
            <p className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(total)}</p>
            <p className="text-xs text-brand-ink-soft">
              {formatBRL(unit)}/{u}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <Button variant="brand" size="xl" className="w-full" onClick={handleAdd} disabled={out}>
            <ShoppingCart />
            {out ? "Produto indisponível" : "Adicionar ao carrinho"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full text-brand-green"
            render={
              <a
                href={whatsappLink(`Olá! Quero cotar ${qty} ${u} de "${product.name}" (SKU ${product.sku}) na Multigiro Central de Compras.`)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <WhatsappIcon className="size-4" />
            Cotar com um vendedor
          </Button>
        </div>
      </div>

      <SaleModeInfo product={product} />

      <CutoffHint expectedAvailabilityDate={product.expectedAvailabilityDate} />

      <ShippingEstimate
        expectedAvailabilityDate={product.expectedAvailabilityDate}
        stockStatus={product.stockStatus}
        subtotal={total}
      />

      <div className="flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 text-sm">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-navy/8 text-brand-navy dark:bg-muted dark:text-foreground">
          <Store className="size-5" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Vendido e entregue por</p>
          <p className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Multigiro Central de Compras</p>
          <p className="text-xs text-brand-ink-soft">Entrega pela CCM ou retirada no CD</p>
        </div>
      </div>

      <ul className="grid grid-cols-3 gap-2 text-center text-[0.7rem] font-medium text-brand-ink-soft">
        {[
          { icon: ShieldCheck, label: "Pagamento protegido" },
          { icon: RotateCcw, label: "7 dias para trocar" },
          { icon: Headset, label: "Suporte por WhatsApp" },
        ].map(({ icon: I, label }) => (
          <li key={label} className="flex flex-col items-center gap-1 rounded-xl bg-card p-2.5">
            <I className="size-4 text-brand-green" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
