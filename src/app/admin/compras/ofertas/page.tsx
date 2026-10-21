import Link from "next/link";

import { Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { offerProducts } from "@/lib/admin/compras-data";

type SP = Record<string, string | undefined>;

export default async function OfertasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const { products, total } = await offerProducts(page);

  return (
    <>
      <PageTitle title="Comparacao de ofertas" subtitle={`${total} produto(s) com oferta ativa`} />

      {products.length === 0 ? (
        <Empty>Nenhum produto com oferta ativa.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>EAN</Th>
                <Th>Marca</Th>
                <Th className="text-right">Ofertas ativas</Th>
                <Th>Recomendacao</Th>
                <Th>Selecao</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const r = p.ranking;
                const hasRec = r?.recommended_offer_id != null;
                const isAmb = r?.ambiguous ?? false;
                const hasSelection = p.selected_offer_id != null;

                return (
                  <tr key={p.master_product_id}>
                    <Td>
                      <Link href={`/admin/compras/ofertas/${p.master_product_id}`} className="font-medium text-brand-navy hover:underline">
                        {p.name}
                      </Link>
                    </Td>
                    <Td className="text-xs">{p.ean ?? "—"}</Td>
                    <Td>{p.brand_slug ?? "—"}</Td>
                    <Td className="text-right">{p.active_offers}</Td>
                    <Td>
                      {hasRec ? (
                        <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Clara</span>
                      ) : isAmb ? (
                        <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Ambigua</span>
                      ) : (
                        <span className="text-xs text-brand-ink-soft">{"—"}</span>
                      )}
                    </Td>
                    <Td>
                      {hasSelection ? (
                        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Selecionada</span>
                      ) : (
                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Pendente</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} total={total} perPage={25} href={(p) => `/admin/compras/ofertas?page=${p}`} />
        </>
      )}
    </>
  );
}
