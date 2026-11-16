import Link from "next/link";

import type { QuickLink } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";
import { Icon } from "@/components/ui/icon";

/** Atalhos de diferenciais: Pix, frete grátis, fornecedor, orçamento, televendas. */
export function QuickLinks({ links }: { links: QuickLink[] }) {
  return (
    <Reveal as="section" className="container-ccm" aria-label="Diferenciais" stagger={0.05}>
      <ul className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {links.map((l) => (
          <li key={l.id} data-reveal className="min-w-[200px] shrink-0 snap-start md:min-w-0">
            <Link
              href={l.href}
              className="lift press flex h-full items-center gap-3 rounded-2xl border border-brand-line bg-card p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-brand-yellow"
            >
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-yellow text-brand-navy">
                <Icon name={l.icon} className="size-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block font-heading text-[0.95rem] font-bold text-brand-navy dark:text-foreground">{l.title}</span>
                <span className="block text-xs text-brand-ink-soft">{l.subtitle}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
