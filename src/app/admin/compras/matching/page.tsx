import { Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { matchingQueue } from "@/lib/admin/compras-data";
import { MatchActions } from "../_components";

type SP = Record<string, string | undefined>;

export default async function MatchingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const { items, total } = await matchingQueue(page);

  return (
    <>
      <PageTitle title="Revisao de matching" subtitle={`${total} item(ns) aguardando revisao`} />

      {items.length === 0 ? (
        <Empty>Nenhum item aguardando revisao.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Item do catalogo</Th>
                <Th>Fornecedor</Th>
                <Th>EAN</Th>
                <Th>Status</Th>
                <Th className="text-right">Confianca</Th>
                <Th>Sugestao</Th>
                <Th>Acoes</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <Td className="max-w-[200px] truncate font-medium">{i.name}</Td>
                  <Td>{i.supplier_name}</Td>
                  <Td className="text-xs">{i.ean ?? "—"}</Td>
                  <Td>
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        i.match_status === "match_sugerido" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {i.match_status === "match_sugerido" ? "Sugerido" : "Manual"}
                    </span>
                  </Td>
                  <Td className="text-right">{i.match_confidence != null ? `${i.match_confidence}%` : "—"}</Td>
                  <Td className="max-w-[200px] truncate text-xs">
                    {i.master_product_name ?? "—"}
                    {i.master_product_ean && <span className="text-brand-ink-soft"> ({i.master_product_ean})</span>}
                  </Td>
                  <Td>
                    {i.master_product_id ? (
                      <MatchActions itemId={i.id} masterProductId={i.master_product_id} />
                    ) : (
                      <span className="text-xs text-brand-ink-soft">Sem sugestao</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} perPage={25} href={(p) => `/admin/compras/matching?page=${p}`} />
        </>
      )}
    </>
  );
}
