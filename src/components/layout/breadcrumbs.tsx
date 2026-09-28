import Link from "next/link";
import { ChevronRight, House } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Crumb {
  href?: string;
  label: string;
}

/** Trilha de navegação: o cliente sempre sabe onde está e como voltar (Nielsen #1 e #3). */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Você está em" className={cn("text-xs text-brand-ink-soft", className)}>
      <ol className="hide-scrollbar flex items-center gap-1 overflow-x-auto whitespace-nowrap">
        <li className="flex items-center gap-1">
          <Link href="/" className="inline-flex items-center gap-1 hover:text-brand-navy hover:underline dark:hover:text-foreground">
            <House className="size-3.5" />
            Início
          </Link>
        </li>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              {it.href && !last ? (
                <Link href={it.href} className="hover:text-brand-navy hover:underline dark:hover:text-foreground">
                  {it.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "font-medium text-brand-ink")}>
                  {it.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
