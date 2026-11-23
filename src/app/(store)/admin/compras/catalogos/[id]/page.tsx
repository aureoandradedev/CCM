import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { Chip, Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { catalogDetail } from "@/lib/admin/compras-data";

type SP = Record<string, string | undefined>;

const MATCH_LABEL: Record<string, string> = {
  pendente: "Pendente",
  normalizado: "Normalizado",
  match_sugerido: "Match sugerido",
  revisao_manual: "Revisao manual",
  aprovado: "Aprovado",
  ignorado: "Ignorado",
  rejeitado: "Rejeitado",
};

function matchCls(s: string) {
  if (s === "aprovado") return "bg-green-100 text-green-800";
  if (s === "ignorado") return "bg-yellow-100 text-yellow-700";
  if (s === "rejeitado") return "bg-red-100 text-red-800";
  if (s === "match_sugerido") return "bg-blue-100 text-blue-800";
  if (s === "revisao_manual") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-800";
}

export default async function CatalogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;

  const page = Number(sp.page ?? 1) || 1;
  const matchStatus = sp.status ?? null;
  const { catalog, items, total } = await catalogDetail(id, matchStatus, page);
  if (!catalog) notFound();

  function href(patch: SP) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
    u.delete("page");
    const s = u.toString();
    return `/admin/compras/catalogos/${id}${s ? `?${s}` : ""}`;
  }

  return (
    <>
      <PageTitle
        title={catalog.supplier_name}
        subtitle={`${catalog.source_name ?? catalog.source} · ${catalog.total_items} itens · ${total} na visao atual`}
      >
        <Link href="/admin/compras/catalogos" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
      </PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip href={href({ status: undefined })} active={!matchStatus}>
          Todos
        </Chip>
        {Object.entries(MATCH_LABEL).map(([k, v]) => (
          <Chip key={k} href={href({ status: k })} active={matchStatus === k}>
            {v}
          </Chip>
        ))}
      </div>

      {items.length === 0 ? (
        <Empty>Nenhum item nesta visao.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>SKU</Th>
                <Th>EAN</Th>
                <Th>Marca</Th>
                <Th>Status</Th>
                <Th className="text-right">Confianca</Th>
                <Th>Produto mestre</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <Td className="max-w-[200px] truncate font-medium">{i.name}</Td>
                  <Td className="text-xs">{i.supplier_sku ?? "—"}</Td>
                  <Td className="text-xs">{i.ean ?? "—"}</Td>
                  <Td>{i.brand ?? "—"}</Td>
                  <Td>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${matchCls(i.match_status)}`}>
                      {MATCH_LABEL[i.match_status] ?? i.match_status}
                    </span>
                  </Td>
                  <Td className="text-right">{i.match_confidence != null ? `${i.match_confidence}%` : "—"}</Td>
                  <Td className="text-xs">
                    {i.master_product_name ? (
                      <Link href={`/admin/compras/ofertas/${i.master_product_id}`} className="text-brand-navy hover:underline">
                        {i.master_product_name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} perPage={25} href={(p) => href({ page: String(p) })} />
        </>
      )}
    </>
  );
}
