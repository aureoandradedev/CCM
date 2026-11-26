"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import Image from "next/image";
import { AlertTriangle, ArrowLeft, ArrowRight, Package, ShieldCheck } from "lucide-react";

import { fetchCurrentPrices, type CurrentPrice } from "@/app/carrinho/actions";
import { CartLineItem } from "@/components/cart/cart-line-item";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { useShippingConfig } from "@/lib/shipping-context";
import { useHydrated } from "@/hooks/use-hydrated";
import { selectLines, selectTotals, useCartStore } from "@/lib/cart/store";
import { groupCartLinesForEstimate } from "@/lib/delivery-promise";
import { formatDate } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

export function CartPage() {
  const { freeShippingFrom, freeShippingLabel } = useShippingConfig();
  const hydrated = useHydrated();
  const lines = useCartStore(useShallow(selectLines));
  const totals = useCartStore(useShallow(selectTotals));
  const deliveryGroups = useMemo(
    () => (lines.length === 0 ? [] : groupCartLinesForEstimate(lines)),
    [lines],
  );
  const clear = useCartStore((s) => s.clear);

  const missingForFree = Math.max(0, freeShippingFrom - totals.subtotal);

  const [priceChanges, setPriceChanges] = useState<Record<string, { old: number; current: number }>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!hydrated || lines.length === 0) return;
    const ids = lines.map((l) => l.productId);
    startTransition(async () => {
      const current = await fetchCurrentPrices(ids);
      const changes: Record<string, { old: number; current: number }> = {};
      for (const line of lines) {
        const cp = current[line.productId];
        if (cp && cp.retailPrice !== line.retailPrice) {
          changes[line.productId] = { old: line.retailPrice, current: cp.retailPrice };
        }
      }
      setPriceChanges(changes);
    });
  }, [hydrated, lines]);

  const changedCount = Object.keys(priceChanges).length;

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
          <p className="max-w-sm text-sm text-brand-ink-soft">Adicione produtos e ganhe frete grátis em compras acima de {freeShippingLabel}.</p>
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
            {changedCount > 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-3 text-sm text-brand-orange">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  {changedCount === 1
                    ? "1 produto teve o preço alterado desde que foi adicionado."
                    : `${changedCount} produtos tiveram o preço alterado desde que foram adicionados.`}
                  {" "}Os preços são revalidados na confirmação do pedido.
                </p>
              </div>
            ) : null}
            {deliveryGroups.length > 1 ? (
              <p className="text-sm text-brand-ink-soft">
                Seu pedido pode chegar em entregas separadas.
              </p>
            ) : null}
            {deliveryGroups.length > 1 ? (
              deliveryGroups.map((g) => {
                const groupLines = g.items.map((entry) => entry.item);
                return (
                  <div key={g.sequence} className="rounded-2xl border border-brand-line bg-card p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-navy dark:text-foreground">
                      <Package className="size-4" />
                      Entrega {g.sequence}
                      {g.promisable ? (
                        <span className="ml-auto text-xs font-normal text-brand-ink-soft">
                          Previsão: {formatDate(g.promisedFrom)} a {formatDate(g.promisedTo)}
                        </span>
                      ) : (
                        <span className="ml-auto text-xs font-normal text-brand-ink-soft">
                          Prazo a confirmar
                        </span>
                      )}
                    </div>
                    <ul className="space-y-3">
                      {groupLines.map((l) => (
                        <CartLineItem key={l.productId} line={l} variant="page" priceChange={priceChanges[l.productId]} />
                      ))}
                    </ul>
                  </div>
                );
              })
            ) : (
              <ul className="space-y-3">
                {lines.map((l) => (
                  <CartLineItem key={l.productId} line={l} variant="page" priceChange={priceChanges[l.productId]} />
                ))}
              </ul>
            )}

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
                  <dt>Subtotal</dt>
                  <dd className="tabular-nums">{formatBRL(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-brand-ink-soft">
                  <dt>Frete</dt>
                  <dd>{totals.subtotal >= freeShippingFrom ? <span className="font-semibold text-brand-green">Grátis</span> : "calculado no checkout"}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-brand-line pt-3">
                  <dt className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Subtotal</dt>
                  <dd className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(totals.subtotal)}</dd>
                </div>
                <p className="text-xs text-brand-ink-soft">Descontos e forma de pagamento definidos após confirmação do pedido.</p>
              </dl>

              {missingForFree > 0 ? (
                <div className="mt-4 rounded-xl bg-brand-yellow-soft p-3 text-xs text-brand-navy dark:text-foreground">
                  <p>
                    Faltam <strong>{formatBRL(missingForFree)}</strong> para frete grátis na entrega.
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                    <div className="h-full rounded-full bg-brand-yellow-2 transition-[width] duration-300" style={{ width: `${Math.min(100, (totals.subtotal / freeShippingFrom) * 100)}%` }} />
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-brand-green/10 p-3 text-xs font-semibold text-brand-green">
                  Parabéns! Você ganhou frete grátis na entrega.
                </div>
              )}

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
