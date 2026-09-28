import Link from "next/link";
import { Check, X } from "lucide-react";

import type { Brand, Category } from "@/types/catalog";
import { catalogHref, countActiveFilters, PRICE_RANGES, type CatalogParams } from "@/lib/catalog-params";
import { cn } from "@/lib/utils";

interface FiltersPanelProps {
  basePath: string;
  params: CatalogParams;
  category?: Category | null;
  brands: Brand[];
  /** esconde a seção de subcategorias (busca, ofertas) */
  hideSubcategories?: boolean;
}

/**
 * Filtros como LINKS (não estado de cliente): funciona sem JS, é compartilhável
 * e o botão "voltar" do navegador se comporta como o cliente espera.
 */
export function FiltersPanel({ basePath, params, category, brands, hideSubcategories }: FiltersPanelProps) {
  const active = countActiveFilters(params);
  const priceActive = (r: { min?: number; max?: number }) => params.min === r.min && params.max === r.max;

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Filtros</h2>
        {active > 0 ? (
          <Link
            href={catalogHref(basePath, params, { sub: undefined, marca: undefined, atacado: false, ofertas: false, min: undefined, max: undefined })}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-red hover:underline"
          >
            <X className="size-3" /> Limpar ({active})
          </Link>
        ) : null}
      </div>

      <FilterGroup title="Condições">
        <ToggleLink href={catalogHref(basePath, params, { atacado: !params.atacado })} active={params.atacado}>
          <span className="rounded bg-brand-orange px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase text-white">Atacado</span>
          Com preço de atacado
        </ToggleLink>
        <ToggleLink href={catalogHref(basePath, params, { ofertas: !params.ofertas })} active={params.ofertas}>
          <span className="rounded bg-brand-red px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase text-white">Oferta</span>
          Em promoção
        </ToggleLink>
      </FilterGroup>

      {!hideSubcategories && category?.children.length ? (
        <FilterGroup title="Subcategorias">
          <ToggleLink href={catalogHref(basePath, params, { sub: undefined })} active={!params.sub} radio>
            Todas em {category.name}
          </ToggleLink>
          {category.children.map((s) => (
            <ToggleLink key={s.slug} href={catalogHref(basePath, params, { sub: params.sub === s.slug ? undefined : s.slug })} active={params.sub === s.slug} radio>
              {s.name}
            </ToggleLink>
          ))}
        </FilterGroup>
      ) : null}

      {brands.length > 1 ? (
        <FilterGroup title="Marcas">
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {brands.map((b) => (
              <ToggleLink key={b.slug} href={catalogHref(basePath, params, { marca: params.marca === b.slug ? undefined : b.slug })} active={params.marca === b.slug}>
                {b.name}
              </ToggleLink>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      <FilterGroup title="Preço (varejo)">
        {PRICE_RANGES.map((r) => (
          <ToggleLink
            key={r.label}
            href={catalogHref(basePath, params, priceActive(r) ? { min: undefined, max: undefined } : { min: r.min, max: r.max })}
            active={priceActive(r)}
            radio
          >
            {r.label}
          </ToggleLink>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-2 text-[0.7rem] font-bold uppercase tracking-wider text-brand-ink-soft">{title}</legend>
      {children}
    </fieldset>
  );
}

function ToggleLink({ href, active, radio = false, children }: { href: string; active: boolean; radio?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-brand-ink transition-colors hover:bg-muted",
        active && "bg-brand-yellow-soft font-semibold text-brand-navy dark:text-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center border-[1.5px] border-brand-ink-soft/50 bg-card transition-colors",
          radio ? "rounded-full" : "rounded-[4px]",
          active && "border-brand-navy bg-brand-navy text-white dark:border-brand-yellow dark:bg-brand-yellow dark:text-brand-navy",
        )}
      >
        {active ? radio ? <span className="size-1.5 rounded-full bg-current" /> : <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="flex items-center gap-1.5">{children}</span>
    </Link>
  );
}
