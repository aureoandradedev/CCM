import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { Category, CategoryTone } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const TONE: Record<CategoryTone, string> = {
  yellow: "bg-brand-yellow-soft text-brand-navy group-hover:bg-brand-yellow",
  orange: "bg-brand-orange-soft text-brand-orange group-hover:bg-brand-orange group-hover:text-white",
  navy: "bg-brand-navy/8 text-brand-navy group-hover:bg-brand-navy group-hover:text-white",
  green: "bg-brand-green-soft text-brand-green group-hover:bg-brand-green group-hover:text-white",
  blue: "bg-brand-blue/10 text-brand-blue group-hover:bg-brand-blue group-hover:text-white",
  red: "bg-brand-red/10 text-brand-red group-hover:bg-brand-red group-hover:text-white",
  slate: "bg-muted text-brand-ink group-hover:bg-brand-navy group-hover:text-white",
};

/** "Compre por departamento" (Obramax): ícones redondos, rolagem horizontal no toque. */
export function DepartmentRail({ categories }: { categories: Category[] }) {
  return (
    <section className="container-ccm" aria-labelledby="departments-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">Navegue</p>
          <h2 id="departments-title" className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy md:text-[1.75rem] dark:text-foreground">
            Compre por departamento
          </h2>
        </div>
        <Link href="/departamentos" className="hidden items-center gap-1 text-sm font-semibold text-brand-navy hover:underline sm:inline-flex dark:text-foreground">
          Ver todos <ArrowRight className="size-4" />
        </Link>
      </div>

      <Reveal stagger={0.04} y={12}>
        <ul className="hide-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-3 md:px-0 lg:grid-cols-10">
          {categories.map((c) => (
            <li key={c.slug} data-reveal className="w-[104px] shrink-0 snap-start md:w-auto">
              <Link href={`/categoria/${c.slug}`} className="group press flex flex-col items-center gap-2.5 rounded-2xl p-2 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <span
                  className={cn(
                    "inline-flex size-[76px] items-center justify-center rounded-full border border-brand-line transition-[background-color,color,transform] duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5 md:size-[88px]",
                    TONE[c.tone ?? "slate"],
                  )}
                >
                  <Icon name={c.icon} className="size-8 md:size-9" strokeWidth={1.8} />
                </span>
                <span className="text-xs leading-tight font-semibold text-brand-ink md:text-[0.8rem]">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
