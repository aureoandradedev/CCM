import Link from "next/link";
import { X } from "lucide-react";

import type { Category, ProductQueryResult } from "@/types/catalog";
import { FiltersPanel } from "@/components/catalog/filters-panel";
import { MobileFilters } from "@/components/catalog/mobile-filters";
import { Pagination } from "@/components/catalog/pagination";
import { ProductGrid } from "@/components/catalog/product-grid";
import { SortSelect } from "@/components/catalog/sort-select";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { catalogHref, countActiveFilters, PAGE_SIZE, PRICE_RANGES, type CatalogParams } from "@/lib/catalog-params";
import { cn } from "@/lib/utils";

interface CatalogListingProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: string;
  basePath: string;
  params: CatalogParams;
  category?: Category | null;
  result: ProductQueryResult;
  crumbs: Crumb[];
  hideSubcategories?: boolean;
  emptyTitle?: string;
  emptyHint?: React.ReactNode;
  /** conteúdo extra abaixo do título (chips de subcategoria, banner) */
  children?: React.ReactNode;
}

/** Listagem padrão (categoria, busca, ofertas, atacado): filtros à esquerda, grade à direita. */
export function CatalogListing({ eyebrow, title, description, basePath, params, category, result, crumbs, hideSubcategories, emptyTitle, emptyHint, children }: CatalogListingProps) {
  const activeCount = countActiveFilters(params);
  const chips: { label: string; href: string }[] = [];
  if (params.sub) {
    const s = category?.children.find((c) => c.slug === params.sub);
    chips.push({ label: s?.name ?? params.sub, href: catalogHref(basePath, params, { sub: undefined }) });
  }
  if (params.marca) {
    const b = result.brands.find((x) => x.slug === params.marca);
    chips.push({ label: `Marca: ${b?.name ?? params.marca}`, href: catalogHref(basePath, params, { marca: undefined }) });
  }
  if (params.ofertas) chips.push({ label: "Em promoção", href: catalogHref(basePath, params, { ofertas: false }) });
  if (params.min !== undefined || params.max !== undefined) {
    const r = PRICE_RANGES.find((x) => x.min === params.min && x.max === params.max);
    chips.push({ label: r?.label ?? "Faixa de preço", href: catalogHref(basePath, params, { min: undefined, max: undefined }) });
  }

  const from = result.total ? (params.pagina - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(result.total, params.pagina * PAGE_SIZE);

  const filters = <FiltersPanel basePath={basePath} params={params} category={category} brands={result.brands} hideSubcategories={hideSubcategories} />;

  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={crumbs} />

      <header className="mt-4 md:mt-6">
        {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">{eyebrow}</p> : null}
        <h1 className="mt-1 font-heading text-[2rem] leading-none font-extrabold tracking-tight text-brand-navy md:text-[2.6rem] dark:text-foreground">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-brand-ink-soft md:text-[0.95rem]">{description}</p> : null}
        {children}
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[250px_1fr]">
        <aside className="hidden lg:block" aria-label="Filtros">
          <div className="sticky top-24 rounded-2xl border border-brand-line bg-card p-5">{filters}</div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-brand-ink-soft" aria-live="polite">
              {result.total ? (
                <>
                  Mostrando <strong className="text-brand-ink">{from}–{to}</strong> de <strong className="text-brand-ink">{result.total}</strong> produtos
                </>
              ) : (
                "Nenhum produto"
              )}
            </p>
            <div className="flex items-center gap-2">
              <MobileFilters activeCount={activeCount}>{filters}</MobileFilters>
              <SortSelect />
            </div>
          </div>

          {chips.length ? (
            <ul className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
              {chips.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className={cn("press inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-navy px-3 text-xs font-semibold text-white hover:bg-brand-navy-2 dark:bg-brand-yellow dark:text-brand-navy")} aria-label={`Remover filtro ${c.label}`}>
                    {c.label}
                    <X className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <ProductGrid products={result.items} emptyTitle={emptyTitle} emptyHint={emptyHint} />
          </div>

          <Pagination basePath={basePath} params={params} total={result.total} pageSize={PAGE_SIZE} />
        </div>
      </div>
    </div>
  );
}
