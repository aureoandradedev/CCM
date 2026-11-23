import Link from "next/link";

import { Empty, NotConfigured, PageTitle, Pagination } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { offerProductsWithComparison } from "@/lib/admin/compras-data";
import { ProductCard } from "./_product-card";

type SP = Record<string, string | undefined>;

export default async function OfertasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const { products, total } = await offerProductsWithComparison(page);

  return (
    <>
      <PageTitle title="Compras — Comparação de fornecedores" subtitle={`${total} produto(s) com oferta ativa`} />

      {products.length === 0 ? (
        <Empty>Nenhum produto com oferta ativa.</Empty>
      ) : (
        <>
          <div className="space-y-3">
            {products.map((p) => (
              <ProductCard
                key={p.master_product_id}
                masterProductId={p.master_product_id}
                name={p.name}
                ean={p.ean}
                brandSlug={p.brand_slug}
                offers={p.offers}
                selectedOfferId={p.selected_offer_id}
                recommendedOfferId={p.recommended_offer_id}
                ambiguous={p.ambiguous}
                sourcingMode={p.sourcing_mode}
              />
            ))}
          </div>
          <div className="mt-4">
            <Pagination page={page} total={total} perPage={25} href={(p) => `/admin/compras/ofertas?page=${p}`} />
          </div>
        </>
      )}

      <div className="mt-4 text-xs">
        <Link href="/admin/compras" className="text-brand-navy hover:underline">
          ← Voltar para Compras
        </Link>
      </div>
    </>
  );
}
