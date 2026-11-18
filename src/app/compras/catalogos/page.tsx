import Link from "next/link";

import { Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { catalogList } from "@/lib/admin/compras-data";
import { ProcessarCatalogoButton } from "@/app/admin/compras/_components";

type SP = Record<string, string | undefined>;

const STATUS_LABEL: Record<string, string> = {
  recebido: "Recebido",
  processando: "Processando",
  analisado: "Analisado",
  com_erros: "Com erros",
  concluido: "Concluido",
};

function statusCls(s: string) {
  if (s === "concluido") return "bg-green-100 text-green-800";
  if (s === "com_erros") return "bg-red-100 text-red-800";
  return "bg-yellow-100 text-yellow-800";
}

export default async function CatalogosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const { catalogs, total } = await catalogList(page);

  return (
    <>
      <PageTitle title="Catálogos" subtitle={`${total} catálogo(s)`} />

      {catalogs.length === 0 ? (
        <Empty>Nenhum catálogo recebido.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Fonte</Th>
                <Th>Status</Th>
                <Th className="text-right">Itens</Th>
                <Th className="text-right">Processados</Th>
                <Th className="text-right">Erros</Th>
                <Th>Data</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {catalogs.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/compras/catalogos/${c.id}`} className="font-medium text-brand-navy hover:underline">
                      {c.supplier_name}
                    </Link>
                  </Td>
                  <Td>{c.source_name ?? c.source}</Td>
                  <Td>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusCls(c.status)}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </Td>
                  <Td className="text-right">{c.total_items}</Td>
                  <Td className="text-right">{c.processed}</Td>
                  <Td className="text-right">{c.errors || "—"}</Td>
                  <Td className="text-sm text-brand-ink-soft">{new Date(c.created_at).toLocaleDateString("pt-BR")}</Td>
                  <Td>
                    <ProcessarCatalogoButton catalogId={c.id} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} total={total} perPage={25} href={(p) => `/compras/catalogos?page=${p}`} />
        </>
      )}
    </>
  );
}
