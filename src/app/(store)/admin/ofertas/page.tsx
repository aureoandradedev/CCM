import Link from "next/link";

import { OffersPaste } from "@/components/admin/offers-paste";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { Card, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { adminListProducts, adminProductIndex, configured } from "@/lib/admin/data";
import { formatBRL } from "@/lib/utils/format";

export default async function AdminOffers() {
  if (!configured()) return <NotConfigured />;
  const [index, { items: emOferta }] = await Promise.all([adminProductIndex(), adminListProducts({ oferta: true, perPage: 200 })]);

  return (
    <>
      <PageTitle title="Ofertas" subtitle="Cole a lista de promoções e aplique de uma vez. Abaixo, tudo que está em oferta agora." />
      <Card title="Colar lista de ofertas">
        <OffersPaste index={index} />
      </Card>

      <h2 className="mt-8 mb-3 font-heading text-lg font-bold text-brand-navy">Em oferta agora ({emOferta.length})</h2>
      {emOferta.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Produto</Th>
              <Th className="text-right">De</Th>
              <Th className="text-right">Por</Th>
              <Th className="text-right">Desconto</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {emOferta.map((p) => {
              const de = Number(p.list_price);
              const por = Number(p.retail_price);
              return (
                <tr key={p.id} className="hover:bg-muted/50">
                  <Td>
                    <Link href={`/admin/produtos/${p.id}`} className="font-semibold text-brand-ink hover:text-brand-navy hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-brand-ink-soft">{p.sku}</p>
                  </Td>
                  <Td className="text-right text-brand-ink-soft line-through tabular-nums">{formatBRL(de)}</Td>
                  <Td className="text-right font-bold text-brand-navy tabular-nums">{formatBRL(por)}</Td>
                  <Td className="text-right font-bold text-brand-red tabular-nums">-{Math.round((1 - por / de) * 100)}%</Td>
                  <Td>
                    <ProductRowActions product={p} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <p className="text-sm text-brand-ink-soft">Nenhum produto em oferta.</p>
      )}
    </>
  );
}
