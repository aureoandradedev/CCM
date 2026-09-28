import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogListing } from "@/components/catalog/catalog-listing";
import { catalogHref, PAGE_SIZE, parseCatalogParams, type SearchParamsRecord } from "@/lib/catalog-params";
import { getCategories, getCategory, getProducts } from "@/lib/data/catalog";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParamsRecord>;
}

export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: "Departamento não encontrado" };
  return {
    title: `${category.name} com preço de atacado`,
    description: category.description,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await getCategory(slug);
  if (!category) notFound();

  const q = parseCatalogParams(sp);
  const basePath = `/categoria/${category.slug}`;
  const result = await getProducts({
    category: category.slug,
    subcategory: q.sub,
    brand: q.marca,
    onlyWholesale: q.atacado,
    onlyOffers: q.ofertas,
    minPrice: q.min,
    maxPrice: q.max,
    sort: q.ordenar,
    limit: PAGE_SIZE,
    offset: (q.pagina - 1) * PAGE_SIZE,
  });

  const sub = q.sub ? category.children.find((s) => s.slug === q.sub) : undefined;

  return (
    <CatalogListing
      eyebrow="Departamento"
      title={sub ? sub.name : category.name}
      description={category.description}
      basePath={basePath}
      params={q}
      category={category}
      result={result}
      crumbs={sub ? [{ href: basePath, label: category.name }, { label: sub.name }] : [{ label: category.name }]}
    >
      {category.children.length ? (
        <ul className="hide-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" aria-label="Subcategorias">
          <li className="shrink-0">
            <Link
              href={catalogHref(basePath, q, { sub: undefined })}
              className={cn(
                "press inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold transition-colors",
                !q.sub ? "border-brand-navy bg-brand-navy text-white dark:border-brand-yellow dark:bg-brand-yellow dark:text-brand-navy" : "border-brand-line bg-card text-brand-ink hover:border-brand-navy/40",
              )}
            >
              Tudo
            </Link>
          </li>
          {category.children.map((s) => (
            <li key={s.slug} className="shrink-0">
              <Link
                href={catalogHref(basePath, q, { sub: s.slug })}
                className={cn(
                  "press inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold transition-colors",
                  q.sub === s.slug ? "border-brand-navy bg-brand-navy text-white dark:border-brand-yellow dark:bg-brand-yellow dark:text-brand-navy" : "border-brand-line bg-card text-brand-ink hover:border-brand-navy/40",
                )}
              >
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </CatalogListing>
  );
}
