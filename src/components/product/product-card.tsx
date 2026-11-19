"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Product } from "@/types/catalog";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { ProductBadges } from "@/components/product/badges";
import { DeliveryHint } from "@/components/product/delivery-hint";
import { ImagePlaceholder } from "@/components/product/image-placeholder";
import { PriceBlock } from "@/components/product/price-block";
import { Rating } from "@/components/product/rating";
import { offerDiscountPct } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: Product;
  className?: string;
  /** prioridade de carregamento da imagem (primeiros cards da home) */
  priority?: boolean;
  sizes?: string;
}

/**
 * Card de produto: referência Obramax (varejo x atacado, botão cheio) com
 * hierarquia Telhanorte (preço grande, Pix, selo de oferta).
 */
export function ProductCard({ product, className, priority = false, sizes = "(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" }: ProductCardProps) {
  const [fav, setFav] = useState(false);
  const href = `/produto/${product.slug}`;
  const off = offerDiscountPct(product);

  return (
    <article
      className={cn(
        "lift group relative flex h-full flex-col overflow-hidden rounded-2xl border border-brand-line bg-card shadow-[var(--shadow-card)]",
        className,
      )}
      data-reveal
    >
      <div className="relative">
        <Link href={href} className="relative block aspect-square overflow-hidden bg-muted" tabIndex={-1} aria-hidden="true">
          {product.images[0] ? (
            <Image
              src={product.images[0]}
              alt=""
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.04]"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </Link>
        <ProductBadges badges={product.badges} discountPct={off} className="absolute top-2.5 left-2.5" />
        <button
          type="button"
          onClick={() => {
            setFav((v) => !v);
            toast(fav ? "Removido dos favoritos" : "Salvo nos favoritos", { id: `fav-${product.id}` });
          }}
          aria-pressed={fav}
          aria-label={fav ? "Remover dos favoritos" : "Salvar nos favoritos"}
          className="press absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-brand-navy shadow-sm backdrop-blur transition-colors hover:bg-white dark:bg-black/50 dark:text-foreground"
        >
          <Heart className={cn("size-4 transition-[fill,color] duration-200", fav && "fill-brand-red text-brand-red")} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="min-h-0 flex-1">
          <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-brand-ink-soft">{product.brand}</p>
          <h3 className="mt-0.5 font-sans text-[0.92rem] leading-snug font-semibold text-brand-ink">
            <Link href={href} className="line-clamp-2 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline">
              {product.name}
            </Link>
          </h3>
          {product.packInfo ? <p className="mt-0.5 text-xs text-brand-ink-soft">{product.packInfo}</p> : null}
          <Rating value={product.rating} count={product.reviewCount} className="mt-1" />
          <DeliveryHint expectedAvailabilityDate={product.expectedAvailabilityDate} stockStatus={product.stockStatus} />
        </div>

        <PriceBlock
          unit={product.unit}
          retailPrice={product.retailPrice}
          wholesalePrice={product.wholesalePrice}
          wholesaleMinQty={product.wholesaleMinQty}
          listPrice={product.listPrice}
          pixDiscountPct={product.pixDiscountPct}
        />

        {/* z-10 para ficar acima do link "esticado" do título */}
        <div className="relative z-10 mt-1">
          <AddToCartButton product={product} inlineStepper />
        </div>
      </div>
    </article>
  );
}
