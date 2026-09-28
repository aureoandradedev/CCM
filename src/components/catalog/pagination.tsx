import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { catalogHref, type CatalogParams } from "@/lib/catalog-params";
import { cn } from "@/lib/utils";

export function Pagination({ basePath, params, total, pageSize }: { basePath: string; params: CatalogParams; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const current = Math.min(params.pagina, pages);

  const window = new Set<number>([1, pages, current, current - 1, current + 1]);
  const list = Array.from(window).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  const btn = "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border border-brand-line bg-card px-3 text-sm font-semibold text-brand-ink transition-colors hover:border-brand-navy/30 hover:bg-muted";

  return (
    <nav aria-label="Paginação" className="mt-8 flex items-center justify-center gap-1.5">
      {current > 1 ? (
        <Link href={catalogHref(basePath, params, { pagina: current - 1 })} className={btn} aria-label="Página anterior" rel="prev">
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span className={cn(btn, "opacity-40")} aria-disabled="true">
          <ChevronLeft className="size-4" />
        </span>
      )}

      {list.map((n, i) => {
        const gap = i > 0 && n - list[i - 1] > 1;
        return (
          <span key={n} className="flex items-center gap-1.5">
            {gap ? <span className="px-1 text-brand-ink-soft">…</span> : null}
            {n === current ? (
              <span aria-current="page" className={cn(btn, "border-brand-navy bg-brand-navy text-white dark:border-brand-yellow dark:bg-brand-yellow dark:text-brand-navy")}>
                {n}
              </span>
            ) : (
              <Link href={catalogHref(basePath, params, { pagina: n })} className={btn}>
                {n}
              </Link>
            )}
          </span>
        );
      })}

      {current < pages ? (
        <Link href={catalogHref(basePath, params, { pagina: current + 1 })} className={btn} aria-label="Próxima página" rel="next">
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cn(btn, "opacity-40")} aria-disabled="true">
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
