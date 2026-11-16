"use client";

import Image from "next/image";

import { ImagePlaceholder } from "@/components/product/image-placeholder";
import Link from "next/link";
import { Trash2 } from "lucide-react";

import { QtyStepper } from "@/components/product/qty-stepper";
import { Button } from "@/components/ui/button";
import { useCartStore, type CartLine } from "@/lib/cart/store";
import { lineTotal, unitPriceFor } from "@/lib/pricing";
import { formatBRL, formatUnit } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface CartLineItemProps {
  line: CartLine;
  /** layout "drawer" (compacto) ou "page" (carrinho completo) */
  variant?: "drawer" | "page";
  highlight?: boolean;
}

export function CartLineItem({ line, variant = "drawer", highlight = false }: CartLineItemProps) {
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const unit = unitPriceFor(line, line.qty);
  const total = lineTotal(line, line.qty);
  const page = variant === "page";

  return (
    <li
      className={cn(
        "relative flex gap-3 rounded-xl border border-transparent p-2 transition-colors duration-500",
        highlight && "border-brand-yellow bg-brand-yellow-soft/60",
        page && "gap-4 border-brand-line bg-card p-3 sm:p-4",
      )}
    >
      <Link href={`/produto/${line.slug}`} className={cn("relative shrink-0 overflow-hidden rounded-lg bg-muted", page ? "size-24 sm:size-28" : "size-[72px]")}>
        {line.image ? <Image src={line.image} alt="" fill sizes={page ? "112px" : "72px"} className="object-cover" /> : <ImagePlaceholder label="" />}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/produto/${line.slug}`} className={cn("line-clamp-2 font-semibold leading-snug text-brand-ink hover:underline", page ? "text-[0.95rem]" : "text-sm")}>
              {line.name}
            </Link>
            {line.packInfo ? <p className="text-xs text-brand-ink-soft">{line.packInfo}</p> : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => remove(line.productId)} aria-label={`Remover ${line.name}`} className="-mt-1 -mr-1 shrink-0 text-brand-ink-soft hover:text-brand-red">
            <Trash2 />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-brand-ink-soft">
            {formatBRL(unit)}/{formatUnit(line.unit)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <QtyStepper value={line.qty} onChange={(n) => setQty(line.productId, n)} allowZero size="sm" />
          <span className={cn("font-heading font-extrabold text-brand-navy tabular-nums dark:text-foreground", page ? "text-xl" : "text-base")}>{formatBRL(total)}</span>
        </div>

      </div>
    </li>
  );
}
