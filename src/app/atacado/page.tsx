import type { Metadata } from "next";
import { Boxes, Calculator, Truck } from "lucide-react";

import { CatalogListing } from "@/components/catalog/catalog-listing";
import { PAGE_SIZE, parseCatalogParams, type SearchParamsRecord } from "@/lib/catalog-params";
import { getProducts } from "@/lib/data/catalog";

export const metadata: Metadata = {
  title: "Atacado: preço por quantidade",
  description: "Compre em quantidade e pague preço de atacado, sem CNPJ e sem pedido mínimo por loja. O preço cai sozinho ao atingir a quantidade mínima.",
};

const PERKS = [
  { icon: Boxes, title: "Sem CNPJ", text: "O preço de atacado vale para qualquer cliente que atingir a quantidade mínima do produto." },
  { icon: Calculator, title: "Cai sozinho", text: "Ao chegar na quantidade, o carrinho troca para o preço de atacado automaticamente." },
  { icon: Truck, title: "Condições especiais", text: "Compras em volume com preços negociados pela Central de Compras junto aos melhores distribuidores da região." },
];

export default async function WholesalePage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const q = parseCatalogParams(await searchParams);
  const result = await getProducts({
    onlyWholesale: true,
    brand: q.marca,
    onlyOffers: q.ofertas,
    minPrice: q.min,
    maxPrice: q.max,
    sort: q.ordenar,
    limit: PAGE_SIZE,
    offset: (q.pagina - 1) * PAGE_SIZE,
  });

  return (
    <CatalogListing
      eyebrow="Compre em quantidade"
      title="Preço de atacado"
      description="Tudo que tem desconto progressivo por quantidade. Ideal para construtoras, pedreiros e quem está fazendo a obra inteira."
      basePath="/atacado"
      params={{ ...q, atacado: false }}
      result={result}
      crumbs={[{ label: "Atacado" }]}
      hideSubcategories
    >
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {PERKS.map((p) => (
          <li key={p.title} className="flex gap-3 rounded-2xl border border-brand-line bg-card p-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange-soft text-brand-orange">
              <p.icon className="size-5" />
            </span>
            <div>
              <p className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">{p.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-brand-ink-soft">{p.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </CatalogListing>
  );
}
