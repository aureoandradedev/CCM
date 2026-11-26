"use client";

import Image from "next/image";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ArrowRight, PackageOpen, ShieldCheck } from "lucide-react";

import { CartLineItem } from "@/components/cart/cart-line-item";
import { FreeShippingBar } from "@/components/cart/free-shipping-bar";
import { PriceChangeAlert } from "@/components/cart/price-change-alert";
import { Button } from "@/components/ui/button";
import { useShippingConfig } from "@/lib/shipping-context";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHydrated } from "@/hooks/use-hydrated";
import { selectLines, selectTotals, useCartStore } from "@/lib/cart/store";
import { formatBRL } from "@/lib/utils/format";

/** Gaveta do carrinho: abre pela direita em qualquer página (Sheet/Base UI). */
export function CartDrawer() {
  const { freeShippingFrom, freeShippingLabel } = useShippingConfig();
  const hydrated = useHydrated();
  const isOpen = useCartStore((s) => s.isOpen);
  const setOpen = useCartStore((s) => s.setOpen);
  const lastAddedId = useCartStore((s) => s.lastAddedId);
  const lines = useCartStore(useShallow(selectLines));
  const totals = useCartStore(useShallow(selectTotals));
  const clear = useCartStore((s) => s.clear);

  return (
    <Sheet open={hydrated && isOpen} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" showCloseButton>
        <SheetHeader className="border-b border-brand-line px-5 py-4">
          <SheetTitle className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">
            Seu carrinho{totals.count ? ` (${totals.count})` : ""}
          </SheetTitle>
        </SheetHeader>

        {lines.length ? (
          <>
            <FreeShippingBar />
            <div className="px-3"><PriceChangeAlert /></div>
            <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {lines.map((line) => (
                <CartLineItem key={line.productId} line={line} highlight={line.productId === lastAddedId} />
              ))}
            </ul>

            <SheetFooter className="gap-3 border-t border-brand-line bg-card px-5 py-4">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between text-brand-ink-soft">
                  <dt>Subtotal ({totals.count} itens)</dt>
                  <dd className="tabular-nums">{formatBRL(totals.subtotal)}</dd>
                </div>
                {totals.subtotal >= freeShippingFrom ? (
                  <div className="flex justify-between font-medium text-brand-green">
                    <dt>Frete</dt>
                    <dd>Grátis</dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between pt-1">
                  <dt className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Subtotal</dt>
                  <dd className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(totals.subtotal)}</dd>
                </div>
                <p className="text-right text-xs text-brand-ink-soft">
                  Frete calculado no checkout
                </p>
              </dl>

              <Button variant="brand" size="xl" className="w-full" render={<Link href="/checkout" onClick={() => setOpen(false)} />}>
                Finalizar compra
                <ArrowRight />
              </Button>
              <div className="flex items-center justify-between">
                <Button variant="link" className="px-0 text-brand-navy dark:text-foreground" render={<Link href="/carrinho" onClick={() => setOpen(false)} />}>
                  Ver carrinho completo
                </Button>
                <Button variant="ghost" size="sm" className="text-brand-ink-soft" onClick={() => clear()}>
                  Esvaziar
                </Button>
              </div>
              <p className="flex items-center gap-1.5 text-[0.7rem] text-brand-ink-soft">
                <ShieldCheck className="size-3.5 text-brand-green" />
                Compra protegida. Pagamento seguro pela Cielo.
              </p>
            </SheetFooter>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <Image src="/brand/mascote-bone-alpha.png" alt="" width={335} height={370} className="h-36 w-auto" />
            <span className="sr-only">
              <PackageOpen className="size-8" />
            </span>
            <div>
              <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Seu carrinho está vazio</p>
              <p className="mt-1 text-sm text-brand-ink-soft">Adicione produtos e ganhe frete grátis acima de {freeShippingLabel}.</p>
            </div>
            <Button variant="brand" size="lg" render={<Link href="/ofertas" onClick={() => setOpen(false)} />}>
              Ver ofertas da semana
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
