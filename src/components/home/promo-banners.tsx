import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PromoBanner {
  id: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  cta: string;
  href: string;
  image: string;
  tone?: "navy" | "orange" | "green";
}

const TONE = {
  navy: "from-brand-navy/95 via-brand-navy/70",
  orange: "from-brand-orange/95 via-brand-orange/65",
  green: "from-brand-green/95 via-brand-green/65",
};

/** Dupla de banners promocionais (Obramax): imagem de fundo, texto forte, CTA. */
export function PromoBanners({ banners }: { banners: PromoBanner[] }) {
  return (
    <Reveal as="section" className="container-ccm" aria-label="Promoções" stagger={0.1}>
      <div className="grid gap-4 md:grid-cols-2">
        {banners.map((b) => (
          <Link
            key={b.id}
            href={b.href}
            data-reveal
            className="group relative block min-h-[220px] overflow-hidden rounded-3xl shadow-[var(--shadow-card)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60 md:min-h-[250px]"
          >
            <Image src={b.image} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04]" />
            <div className={cn("absolute inset-0 bg-gradient-to-r to-transparent", TONE[b.tone ?? "navy"])} />
            <div className="relative flex h-full min-h-[220px] flex-col justify-center p-7 text-white md:min-h-[250px] md:p-9">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-yellow">{b.eyebrow}</p>
              <h3 className="mt-2 max-w-xs font-heading text-[1.85rem] leading-none font-extrabold tracking-tight md:text-[2.2rem]">{b.title}</h3>
              {b.subtitle ? <p className="mt-2 max-w-xs text-sm opacity-90">{b.subtitle}</p> : null}
              <span className={cn(buttonVariants({ variant: "brand" }), "mt-5 w-fit group-hover:bg-brand-yellow-2")}>
                {b.cta}
                <ArrowRight />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Reveal>
  );
}
