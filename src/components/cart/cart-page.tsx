"use client";

import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";

import { CartLineItem } from "@/components/cart/cart-line-item";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FREE_SHIPPING_FROM } from "@/components/product/shipping-estimate";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { selectLines, selectTotals, useCartStore } from "@/lib/cart/store";
import { formatBRL } from "@/lib/utils/format";

export function CartPage() {
  const hydrated = useHydrated();
  const lines = useCartStore(useShallow(selectLines));
  const totals = useCartStore(useShallow(selectTotals));
  const clear = useCartStore((s) => s.clear);

  const missingForFree = Math.max(0, FREE_SHIPPING_FROM - totals.subtotal);

  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Carrinho" }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 md:mt-6">
        <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:text-[2.6rem] dark:text-foreground">
          Seu carrinho{hydrated && totals.count ? <span className="ml-2 text-lg font-bold text-brand-ink-soft">({totals.count} {totals.count === 1 ? "item" : "itens"})</span> : null}
        </h1>
        {hydrated && lines.length ? (
          <Button variant="ghost" size="sm" className="text-brand-ink-soft" onClick={() => clear()}>
            Esvaziar carrinho
          </Button>
        ) : null}
      </div>

      {!hydrated ? (
        <div className="mt-6 h-64 animate-pulse rounded-3xl bg-muted" />
      ) : lines.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-brand-line bg-card px-6 py-16 text-center">
          <Image src="/brand/mascote-bone-alpha.png" alt="" width={335} height={370} className="h-40 w-auto" />
          <p className="font-heading text-xl font-bold text-brand-navy dark:text-foreground">Seu carrinho está vazio</p>
          <p className="max-w-sm text-sm text-brand-ink-soft">Monte a lista da obra: o preço de atacado é aplicado sozinho ao atingir a quantidade mínima.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="brand" size="lg" render={<Link href="/ofertas" />}>
              Ver ofertas
            </Button>
            <Button variant="outline-navy" size="lg" render={<Link href="/departamentos" />}>
              Departamentos
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <ul className="space-y-3">
              {lines.map((l) => (
                <CartLineItem key={l.productId} line={l} variant="page" />
              ))}
            </ul>

            <Button variant="link" className="px-0 text-brand-navy dark:text-foreground" render={<Link href="/departamentos" />}>
              <ArrowLeft />
              Continuar comprando
            </Button>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl border border-brand-line bg-card p-6 shadow-[var(--shadow-card)]">
              <h2 className="font-heading text-lg font-extrabold text-brand-navy dark:text-foreground">Resumo</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between text-brand-ink-soft">
                  <dt>Subtotal (preço de varejo)</dt>
                  <dd className="tabular-nums">{formatBRL(totals.retailSubtotal)}</dd>
                </div>
                {totals.wholesaleSavings > 0 ? (
                  <div className="flex justify-between font-medium text-brand-green">
                    <dt>Economia no atacado</dt>
                    <dd className="tabular-nums">- {formatBRL(totals.wholesaleSavings)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between text-brand-ink-soft">
                  <dt>Frete</dt>
                  <dd>{totals.subtotal >= FREE_SHIPPING_FROM ? <span className="font-semibold text-brand-green">Grátis</span> : "calculado no checkout"}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-brand-line pt-3">
                  <dt className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Total</dt>
                  <dd className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-sm font-semibold text-brand-green">
                  <dt>No Pix (5% off)</dt>
                  <dd className="tabular-nums">{formatBRL(totals.pixTotal)}</dd>
                </div>
              </dl>

              {missingForFree > 0 ? (
                <div className="mt-4 rounded-xl bg-brand-yellow-soft p-3 text-xs text-brand-navy dark:text-foreground">
                  <p>
                    Faltam <strong>{formatBRL(missingForFree)}</strong> para frete grátis na entrega.
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                    <div className="h-full rounded-full bg-brand-yellow-2 transition-[width] duration-300" style={{ width: `${Math.min(100, (totals.subtotal / FREE_SHIPPING_FROM) * 100)}%` }} />
                  </div>
                </div>
              ) : null}

              <Button variant="brand" size="xl" className="mt-5 w-full" render={<Link href="/checkout" />}>
                Finalizar compra
                <ArrowRight />
              </Button>
              <p className="mt-3 flex items-start gap-1.5 text-[0.72rem] text-brand-ink-soft">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-green" />
                Preços revalidados na confirmação do pedido. Compra protegida.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
