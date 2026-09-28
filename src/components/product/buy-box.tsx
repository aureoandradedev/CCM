"use client";

import { Headset, RotateCcw, ShieldCheck, ShoppingCart, Store } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Product } from "@/types/catalog";
import { PriceBlock } from "@/components/product/price-block";
import { QtyStepper } from "@/components/product/qty-stepper";
import { ShippingEstimate } from "@/components/product/shipping-estimate";
import { Button } from "@/components/ui/button";
import { WhatsappIcon } from "@/components/ui/social-icons";
import { useCartStore } from "@/lib/cart/store";
import { hasWholesale, isWholesaleActive, lineTotal, unitPriceFor, unitsToWholesale } from "@/lib/pricing";
import { whatsappLink } from "@/lib/site";
import { formatBRL, formatUnit } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/** Caixa de compra da página do produto: preço, atacado progressivo, quantidade, CTA, frete e fornecedor. */
export function BuyBox({ product }: { product: Product }) {
  const [qty, setQty] = useState(1);
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);

  const ws = hasWholesale(product);
  const wsActive = isWholesaleActive(product, qty);
  const missing = unitsToWholesale(product, qty);
  const unit = unitPriceFor(product, qty);
  const total = lineTotal(product, qty);
  const min = product.wholesaleMinQty ?? 0;
  const progress = ws ? Math.min(100, Math.round((qty / min) * 100)) : 0;
  const out = product.stockStatus === "out";
  const u = formatUnit(product.unit);

  const handleAdd = () => {
    add(product, qty);
    toast.success(`${qty} ${u} de ${product.name} no carrinho`, {
      id: `cart-${product.id}`,
      description: wsActive ? "Preço de atacado aplicado." : missing > 0 ? `Faltam ${missing} ${u} para o preço de atacado.` : undefined,
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

        {ws ? (
          <div className="mt-4 rounded-2xl bg-brand-orange-soft p-3.5 text-sm" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-brand-navy dark:text-foreground">
                {wsActive ? (
                  <>Preço de atacado ativo: {formatBRL(product.wholesalePrice as number)}/{u}</>
                ) : (
                  <>
                    Faltam <strong>{missing} {u}</strong> para pagar {formatBRL(product.wholesalePrice as number)}/{u}
                  </>
                )}
              </p>
              {!wsActive ? (
                <button type="button" onClick={() => setQty(min)} className="press shrink-0 rounded-md bg-brand-orange px-2 py-1 text-xs font-bold text-white hover:bg-[#e67c00]">
                  Completar {min}
                </button>
              ) : null}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso para o preço de atacado">
              <div className="h-full rounded-full bg-brand-orange transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Quantidade ({u})</p>
            <QtyStepper value={qty} onChange={setQty} size="lg" />
          </div>
          <div className="text-right">
            <p className="text-xs text-brand-ink-soft">Total para {qty} {u}</p>
            <p className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(total)}</p>
            <p className={cn("text-xs", wsActive ? "font-semibold text-brand-orange" : "text-brand-ink-soft")}>
              {formatBRL(unit)}/{u} {wsActive ? "· atacado" : ""}
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

      <ShippingEstimate leadTimeDays={product.supplier?.leadTimeDays} subtotal={total} supplierCity={product.supplier?.city} />

      {product.supplier ? (
        <div className="flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 text-sm">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-navy/8 text-brand-navy dark:bg-muted dark:text-foreground">
            <Store className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Vendido e entregue por</p>
            <p className="font-heading text-base font-bold text-brand-navy dark:text-foreground">{product.supplier.name}</p>
            <p className="text-xs text-brand-ink-soft">
              {product.supplier.city ? `${product.supplier.city} · ` : ""}despacha em {product.supplier.leadTimeDays} {product.supplier.leadTimeDays === 1 ? "dia útil" : "dias úteis"} · fornecedor parceiro verificado
            </p>
          </div>
        </div>
      ) : null}

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
