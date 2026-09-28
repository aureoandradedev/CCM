"use client";

import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import type { Product } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";
import { ProductCard } from "@/components/product/product-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProductRailProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  href?: string;
  hrefLabel?: string;
  products: Product[];
  className?: string;
  /** prioriza as primeiras imagens (só na primeira vitrine da home) */
  priorityFirst?: number;
}

/**
 * Vitrine horizontal de produtos (Telhanorte/Obramax): título forte à esquerda,
 * "ver todos" à direita, setas no desktop e arraste livre no toque.
 */
export function ProductRail({ title, subtitle, eyebrow, href, hrefLabel = "Ver todos", products, className, priorityFirst = 0 }: ProductRailProps) {
  const [emblaRef, embla] = useEmblaCarousel({ align: "start", containScroll: "trimSnaps", slidesToScroll: "auto", dragFree: false });

  // estado das setas lido direto do embla (fonte externa): bit 1 = pode voltar, bit 2 = pode avançar
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!embla) return () => {};
      embla.on("select", cb);
      embla.on("reInit", cb);
      return () => {
        embla.off("select", cb);
        embla.off("reInit", cb);
      };
    },
    [embla],
  );
  const scrollState = useSyncExternalStore(
    subscribe,
    () => (embla ? (embla.canScrollPrev() ? 1 : 0) | (embla.canScrollNext() ? 2 : 0) : 2),
    () => 2,
  );
  const canPrev = (scrollState & 1) === 1;
  const canNext = (scrollState & 2) === 2;

  if (!products.length) return null;

  return (
    <section className={cn("container-ccm", className)} aria-labelledby={`rail-${slug(title)}`}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">{eyebrow}</p> : null}
          <h2 id={`rail-${slug(title)}`} className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy md:text-[1.75rem] dark:text-foreground">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-sm text-brand-ink-soft">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {href ? (
            <Button variant="link" className="hidden px-0 text-brand-navy sm:inline-flex dark:text-foreground" render={<Link href={href} />}>
              {hrefLabel}
              <ArrowRight />
            </Button>
          ) : null}
          <div className="hidden items-center gap-1 md:flex">
            <Button variant="outline" size="icon" onClick={() => embla?.scrollPrev()} disabled={!canPrev} aria-label="Anterior" className="rounded-full">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" onClick={() => embla?.scrollNext()} disabled={!canNext} aria-label="Próximo" className="rounded-full">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <Reveal>
        <div ref={emblaRef} className="overflow-hidden -mx-1 px-1 py-1">
          <div className="flex touch-pan-y -ml-3 md:-ml-4">
            {products.map((p, i) => (
              <div key={p.id} className="min-w-0 shrink-0 grow-0 basis-[72%] pl-3 sm:basis-[46%] md:basis-1/3 md:pl-4 lg:basis-1/4 xl:basis-1/5">
                <ProductCard product={p} priority={i < priorityFirst} />
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {href ? (
        <div className="mt-4 sm:hidden">
          <Button variant="outline-navy" className="w-full" render={<Link href={href} />}>
            {hrefLabel}
            <ArrowRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
}
