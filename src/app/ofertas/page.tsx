import type { Metadata } from "next";

import { CatalogListing } from "@/components/catalog/catalog-listing";
import { PAGE_SIZE, parseCatalogParams, type SearchParamsRecord } from "@/lib/catalog-params";
import { getProducts } from "@/lib/data/catalog";

export const metadata: Metadata = {
  title: "Ofertas da semana",
  description: "Material de construção em promoção com desconto extra no Pix, direto dos fornecedores parceiros da Multigiro Central de Compras.",
};

export default async function OffersPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const q = parseCatalogParams(await searchParams);
  const result = await getProducts({
    onlyOffers: true,
    brand: q.marca,
    onlyWholesale: q.atacado,
    minPrice: q.min,
    maxPrice: q.max,
    sort: q.ordenar,
    limit: PAGE_SIZE,
    offset: (q.pagina - 1) * PAGE_SIZE,
  });

  return (
    <CatalogListing
      eyebrow="Só esta semana"
      title="Ofertas da semana"
      description="Preço de fábrica com desconto extra de 5% no Pix. As ofertas valem enquanto o fornecedor mantiver o lote."
      basePath="/ofertas"
      params={{ ...q, ofertas: false }}
      result={result}
      crumbs={[{ label: "Ofertas" }]}
      hideSubcategories
    />
  );
}
