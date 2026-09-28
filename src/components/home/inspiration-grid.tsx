import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { Inspiration } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";

/**
 * Seção editorial inspirada em Deca/Portobello: título grande, frase curta e
 * mosaico de ambientes com legenda sobre a foto. Leva para as categorias.
 */
export function InspirationGrid({ items }: { items: Inspiration[] }) {
  return (
    <Reveal as="section" className="container-ccm" aria-labelledby="inspire-title" stagger={0.08}>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div data-reveal>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-orange">#Inspire-se</p>
          <h2 id="inspire-title" className="mt-2 font-heading text-[2.2rem] leading-[0.98] font-extrabold tracking-tight text-brand-navy md:text-[3rem] dark:text-foreground">
            Ambientes que <span className="text-brand-orange">inspiram</span> a obra.
          </h2>
        </div>
        <p data-reveal className="max-w-sm text-sm leading-relaxed text-brand-ink-soft md:text-right">
          Veja o material aplicado de verdade e monte a lista do ambiente inteiro com um clique.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4 md:grid-rows-2">
        {items.map((it, i) => (
          <Link
            key={it.id}
            href={it.href}
            data-reveal
            className={cn(
              "group relative block overflow-hidden rounded-3xl bg-muted shadow-[var(--shadow-card)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
              i === 0 ? "min-h-[320px] md:col-span-2 md:row-span-2 md:min-h-[520px]" : "min-h-[220px] md:min-h-0",
            )}
          >
            <Image
              src={it.image}
              alt={it.title}
              fill
              sizes={i === 0 ? "(min-width: 768px) 50vw, 100vw" : "(min-width: 768px) 25vw, 100vw"}
              className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.05]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-navy/85 via-brand-navy/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 text-white md:p-6">
              <div>
                <h3 className={cn("font-heading font-extrabold tracking-tight", i === 0 ? "text-2xl md:text-3xl" : "text-xl")}>{it.title}</h3>
                <p className="mt-1 text-sm text-white/80">{it.subtitle}</p>
              </div>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-[background-color,transform] duration-200 ease-[var(--ease-out)] group-hover:bg-brand-yellow group-hover:text-brand-navy group-hover:-translate-y-0.5">
                <ArrowUpRight className="size-5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}
