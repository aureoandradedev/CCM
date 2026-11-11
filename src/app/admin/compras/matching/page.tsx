import { Chip, Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { matchingQueueByStatus, matchingStatusCounts } from "@/lib/admin/compras-data";
import { NoMasterActions } from "../_components";

type SP = Record<string, string | undefined>;

const TABS = [
  { key: "revisao", label: "Revisao" },
  { key: "sem_master", label: "Baixa confianca" },
  { key: "aprovado", label: "Aprovados" },
  { key: "rejeitado", label: "Rejeitados" },
] as const;

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  match_sugerido: { label: "Sugerido", cls: "bg-blue-100 text-blue-800" },
  revisao_manual: { label: "Manual", cls: "bg-amber-100 text-amber-800" },
  normalizado: { label: "Normalizado", cls: "bg-pink-100 text-pink-800" },
  aprovado: { label: "Aprovado", cls: "bg-green-100 text-green-800" },
  rejeitado: { label: "Rejeitado", cls: "bg-gray-100 text-gray-600" },
};

export default async function MatchingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;

  const tab = (sp.tab as string) || "revisao";
  const page = Number(sp.page ?? 1) || 1;

  const [counts, { items, total }] = await Promise.all([
    matchingStatusCounts(),
    matchingQueueByStatus(tab, page),
  ]);

  const isSemMaster = tab === "sem_master";
  const isReview = tab === "revisao";

  return (
    <>
      <PageTitle title="Fila de matching" subtitle={`${total} item(ns)`} />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Chip key={t.key} href={`/admin/compras/matching?tab=${t.key}`} active={tab === t.key}>
            {t.label} ({counts[t.key] ?? 0})
          </Chip>
        ))}
      </div>

      {items.length === 0 ? (
        <Empty>
          {isSemMaster
            ? "Nenhum item normalizado sem produto mestre."
            : isReview
              ? "Nenhum item aguardando revisao."
              : `Nenhum item ${tab === "aprovado" ? "aprovado" : "rejeitado"}.`}
        </Empty>
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
                {(isReview || isSemMaster) && <Th>Acoes</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const badge = STATUS_BADGES[i.match_status] ?? { label: i.match_status, cls: "bg-gray-100 text-gray-700" };
                return (
                  <tr key={i.id}>
                    <Td className="max-w-[200px] truncate font-medium">
                      {i.name}
                      {i.brand && <span className="ml-1 text-xs text-brand-ink-soft">({i.brand})</span>}
                    </Td>
                    <Td>{i.supplier_name}</Td>
                    <Td className="text-xs">{i.ean ?? "—"}</Td>
                    <Td>
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </Td>
                    <Td className="text-right">{i.match_confidence != null ? `${i.match_confidence}%` : "—"}</Td>
                    <Td className="max-w-[200px] truncate text-xs">
                      {i.master_product_name ?? "—"}
                      {i.master_product_ean && <span className="text-brand-ink-soft"> ({i.master_product_ean})</span>}
                    </Td>
                    {isReview && (
                      <Td>
                        <NoMasterActions
                          reviewMode
                          item={{
                            id: i.id,
                            name: i.name,
                            brand: i.brand,
                            model: i.model,
                            ean: i.ean,
                            category_original: i.category_original,
                            normalized_data: i.normalized_data,
                            master_product_id: i.master_product_id,
                            master_product_name: i.master_product_name,
                          }}
                        />
                      </Td>
                    )}
                    {isSemMaster && (
                      <Td>
                        <NoMasterActions
                          item={{
                            id: i.id,
                            name: i.name,
                            brand: i.brand,
                            model: i.model,
                            ean: i.ean,
                            category_original: i.category_original,
                            normalized_data: i.normalized_data,
                            master_product_id: i.master_product_id,
                            master_product_name: i.master_product_name,
                          }}
                        />
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} total={total} perPage={25} href={(p) => `/admin/compras/matching?tab=${tab}&page=${p}`} />
        </>
      )}
    </>
  );
}
