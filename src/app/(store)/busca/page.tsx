import type { Metadata } from "next";

import { CatalogListing } from "@/components/catalog/catalog-listing";
import { DepartmentRail } from "@/components/home/department-rail";
import { SearchBar } from "@/components/layout/search-bar";
import { PAGE_SIZE, parseCatalogParams, type SearchParamsRecord } from "@/lib/catalog-params";
import { getCategories, getProducts } from "@/lib/data/catalog";

interface Props {
  searchParams: Promise<SearchParamsRecord>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseCatalogParams(await searchParams);
  return { title: q.q ? `Busca: ${q.q}` : "Buscar produtos", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = parseCatalogParams(await searchParams);

  if (!q.q && !q.marca) {
    const categories = await getCategories();
    return (
      <div className="space-y-10 pt-6">
        <section className="container-ccm">
          <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:text-[2.6rem] dark:text-foreground">O que a sua obra precisa hoje?</h1>
          <p className="mt-2 text-sm text-brand-ink-soft">Busque por produto, marca ou código. Dica: &ldquo;cimento 50kg&rdquo;, &ldquo;porcelanato 90x90&rdquo;, &ldquo;cabo 2,5&rdquo;.</p>
          <div className="mt-5 max-w-2xl">
            <SearchBar autoFocus />
          </div>
        </section>
        <DepartmentRail categories={categories} />
      </div>
    );
  }

  const result = await getProducts({
    search: q.q,
    brand: q.marca,
    onlyWholesale: q.atacado,
    onlyOffers: q.ofertas,
    minPrice: q.min,
    maxPrice: q.max,
    sort: q.ordenar,
    limit: PAGE_SIZE,
    offset: (q.pagina - 1) * PAGE_SIZE,
  });

  const brandName = q.marca ? result.brands.find((b) => b.slug === q.marca)?.name : undefined;

  return (
    <CatalogListing
      eyebrow={q.q ? "Resultados da busca" : "Marca"}
      title={
        q.q ? (
          <>
            &ldquo;{q.q}&rdquo;
          </>
        ) : (
          brandName ?? q.marca
        )
      }
      description={result.total ? undefined : "Nao encontramos esse item no catalogo atual. Tente um sinonimo ou peca uma cotacao pelo WhatsApp."}
      basePath="/busca"
      params={q}
      result={result}
      crumbs={[{ href: "/busca", label: "Busca" }, { label: q.q ?? brandName ?? "Marca" }]}
      hideSubcategories
      emptyTitle={`Nada encontrado para "${q.q ?? brandName ?? ""}"`}
    />
  );
}
