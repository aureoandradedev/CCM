import { Chip, Empty, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { configured, readOperationalExceptions } from "@/lib/admin/data";
import { ExceptionBadge, ResolveExceptionForm } from "@/app/admin/compras/_components";

type SP = Record<string, string | undefined>;

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  investigating: "Investigando",
  resolved: "Resolvida",
  accepted: "Aceita",
};

const TYPE_LABEL: Record<string, string> = {
  shortage: "Falta",
  damage: "Avaria",
  swap: "Troca",
  excess: "Excedente",
  late_delivery: "Atraso",
  other: "Outro",
};

export default async function ExcecoesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;

  const statusFilter = sp.status ?? null;
  const exceptions = await readOperationalExceptions(statusFilter ?? undefined);

  const comprasTypes = new Set(["shortage", "damage", "swap", "excess", "late_delivery", "other"]);
  const filtered = exceptions.filter((e) => comprasTypes.has(e.type));

  const openCount = filtered.filter((e) => e.resolution_status === "open").length;
  const investigatingCount = filtered.filter((e) => e.resolution_status === "investigating").length;

  return (
    <>
      <PageTitle
        title="Exceções"
        subtitle={`${filtered.length} exceção(ões) · ${openCount} aberta(s) · ${investigatingCount} investigando`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip href="/compras/excecoes" active={!statusFilter}>
          Todas
        </Chip>
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <Chip key={k} href={`/compras/excecoes?status=${k}`} active={statusFilter === k}>
            {v}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty>Nenhuma exceção encontrada.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tipo</Th>
              <Th>Severidade</Th>
              <Th>Fornecedor</Th>
              <Th>Status</Th>
              <Th>Data</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <Td>
                  <ExceptionBadge type={e.type} severity={e.severity} />
                  <span className="ml-2 text-sm">{TYPE_LABEL[e.type] ?? e.type}</span>
                </Td>
                <Td className="text-sm capitalize">{e.severity}</Td>
                <Td className="text-sm">{e.suppliers?.name ?? "—"}</Td>
                <Td>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                    e.resolution_status === "open"
                      ? "bg-red-100 text-red-800"
                      : e.resolution_status === "investigating"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-green-100 text-green-800"
                  }`}>
                    {STATUS_LABEL[e.resolution_status] ?? e.resolution_status}
                  </span>
                </Td>
                <Td className="text-sm text-brand-ink-soft">
                  {new Date(e.created_at).toLocaleDateString("pt-BR")}
                </Td>
                <Td>
                  {(e.resolution_status === "open" || e.resolution_status === "investigating") && (
                    <ResolveExceptionForm exceptionId={e.id} />
                  )}
                  {e.resolution_notes && (
                    <p className="mt-1 text-xs text-brand-ink-soft">{e.resolution_notes}</p>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
