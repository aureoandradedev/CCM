"use client";

import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Banner } from "@/types/catalog";
import { Button } from "@/components/ui/button";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/utils";

const THEME: Record<Banner["theme"], { bg: string; text: string; eyebrow: string; cta: "brand" | "navy"; fade: string }> = {
  navy: { bg: "bg-brand-navy", text: "text-white", eyebrow: "bg-brand-yellow text-brand-navy", cta: "brand", fade: "from-brand-navy via-brand-navy/85 to-brand-navy/10" },
  yellow: { bg: "bg-brand-yellow", text: "text-brand-navy", eyebrow: "bg-brand-navy text-brand-yellow", cta: "navy", fade: "from-brand-yellow via-brand-yellow/85 to-brand-yellow/10" },
  orange: { bg: "bg-brand-orange", text: "text-white", eyebrow: "bg-white text-brand-orange", cta: "navy", fade: "from-brand-orange via-brand-orange/85 to-brand-orange/10" },
  dark: { bg: "bg-[#161616]", text: "text-white", eyebrow: "bg-brand-yellow text-brand-navy", cta: "brand", fade: "from-[#161616] via-[#161616]/85 to-[#161616]/10" },
};

type EmblaApi = NonNullable<ReturnType<typeof useEmblaCarousel>[1]>;

/** Índice do slide ativo lido direto do embla (fonte externa), sem setState em efeito. */
function useSelectedIndex(embla: EmblaApi | undefined) {
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
  return useSyncExternalStore(
    subscribe,
    () => embla?.selectedScrollSnap() ?? 0,
    () => 0,
  );
}

/**
 * Carrossel principal (Telhanorte/Obramax): banner largo com cantos
 * arredondados, texto à esquerda entrando em cascata (GSAP) a cada slide,
 * autoplay que pausa no hover e setas/pontos acessíveis.
 */
export function HeroCarousel({ banners }: { banners: Banner[] }) {
  // plugin criado uma vez (useState com inicializador, sem ler ref durante o render)
  const [plugins] = useState(() => [Autoplay({ delay: 6000, stopOnInteraction: false, stopOnMouseEnter: true })]);
  const [emblaRef, embla] = useEmblaCarousel({ loop: true, duration: 28 }, plugins);
  const index = useSelectedIndex(embla);
  const rootRef = useRef<HTMLDivElement>(null);

  // Entrada em cascata do texto a cada slide. gsap.context + revert no cleanup
  // (padrão gsap-react para efeitos que dependem de um sistema externo, o embla).
  useEffect(() => {
    const root = rootRef.current;
    if (!embla || !root) return;
    const ctx = gsap.context(() => {}, root);
    let first = true;

    const run = () => {
      const i = embla.selectedScrollSnap();
      // o primeiro slide entra por animação CSS (não depende de JS, sem flash no LCP)
      if (first) {
        first = false;
        if (i === 0) return;
      }
      const slide = root.querySelectorAll<HTMLElement>("[data-hero-slide]")[i];
      if (!slide) return;
      const els = slide.querySelectorAll<HTMLElement>("[data-hero-el]");
      ctx.add(() => {
        if (prefersReducedMotion()) {
          gsap.set(els, { opacity: 1, y: 0 });
          return;
        }
        gsap.fromTo(els, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: "power3.out", overwrite: true, delay: 0.1 });
      });
    };

    run();
    embla.on("select", run);
    return () => {
      embla.off("select", run);
      ctx.revert();
    };
  }, [embla]);

  if (!banners.length) return null;

  return (
    <section className="container-ccm" aria-roledescription="carrossel" aria-label="Destaques">
      <div ref={rootRef} className="group/hero relative overflow-hidden rounded-3xl shadow-[var(--shadow-card)]">
        <div ref={emblaRef} className="overflow-hidden">
          <div className="flex touch-pan-y">
            {banners.map((b, i) => {
              const t = THEME[b.theme];
              return (
                <div
                  key={b.id}
                  data-hero-slide
                  className={cn("relative min-w-0 shrink-0 grow-0 basis-full", i === 0 && "hero-first", t.bg, t.text)}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} de ${banners.length}`}
                >
                  {b.variant === "mascot" ? (
                    <>
                      {/* mascote recortado sobre fundo da marca com um "sol" amarelo atrás */}
                      <div aria-hidden="true" className="absolute -right-16 -bottom-48 size-[440px] rounded-full bg-brand-yellow/15 md:-right-10 md:-bottom-56 md:size-[640px]" />
                      <div className="absolute top-3 right-2 h-[50%] w-[58%] md:inset-y-0 md:top-auto md:right-6 md:h-full md:w-[44%] lg:right-14">
                        <Image
                          src={b.image}
                          alt=""
                          fill
                          priority={i === 0}
                          sizes="(min-width: 1400px) 600px, (min-width: 768px) 44vw, 58vw"
                          className="object-contain object-right-top md:object-bottom"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-y-0 right-0 w-full md:w-[62%]">
                      <Image
                        src={b.image}
                        alt=""
                        fill
                        priority={i === 0}
                        sizes="(min-width: 1400px) 900px, (min-width: 768px) 62vw, 100vw"
                        className="object-cover"
                      />
                      <div className={cn("absolute inset-0 hidden bg-gradient-to-r md:block", t.fade)} style={{ width: "45%" }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent md:hidden" />
                    </div>
                  )}

                  <div className="relative flex min-h-[440px] flex-col justify-end px-6 pt-10 pb-8 md:min-h-[470px] md:max-w-[52%] md:justify-center md:px-12 md:py-12 lg:px-16">
                    {b.eyebrow ? (
                      <span data-hero-el style={{ "--i": 0 } as React.CSSProperties} className={cn("mb-4 inline-flex w-fit items-center rounded-full px-3 py-1 font-heading text-xs font-bold uppercase tracking-[0.12em]", t.eyebrow)}>
                        {b.eyebrow}
                      </span>
                    ) : null}
                    <h2 data-hero-el style={{ "--i": 1 } as React.CSSProperties} className="font-heading text-[2.35rem] leading-[0.98] font-extrabold tracking-tight text-balance md:text-[3.4rem] lg:text-[3.9rem]">
                      {b.title}
                    </h2>
                    {b.subtitle ? (
                      <p data-hero-el style={{ "--i": 2 } as React.CSSProperties} className="mt-4 max-w-md text-[0.95rem] leading-relaxed opacity-90 md:text-base">
                        {b.subtitle}
                      </p>
                    ) : null}
                    <div data-hero-el style={{ "--i": 3 } as React.CSSProperties} className="mt-6">
                      <Button variant={t.cta} size="xl" render={<Link href={b.href} />}>
                        {b.cta}
                        <ArrowRight />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-2 md:bottom-6">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => embla?.scrollTo(i)}
              aria-label={`Ir para o slide ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "pointer-events-auto h-2 rounded-full bg-white/60 transition-[width,background-color] duration-300 ease-[var(--ease-out)]",
                i === index ? "w-8 bg-white" : "w-2 hover:bg-white/90",
              )}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-4 hidden items-center gap-2 md:flex">
          <Button variant="outline" size="icon-lg" onClick={() => embla?.scrollPrev()} aria-label="Slide anterior" className="pointer-events-auto rounded-full border-white/40 bg-white/85 text-brand-navy opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover/hero:opacity-100 focus-visible:opacity-100">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-lg" onClick={() => embla?.scrollNext()} aria-label="Próximo slide" className="pointer-events-auto rounded-full border-white/40 bg-white/85 text-brand-navy opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover/hero:opacity-100 focus-visible:opacity-100">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </section>
  );
}
