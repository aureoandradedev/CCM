import Link from "next/link";
import { ArrowLeft, ClipboardCheck, AlertTriangle } from "lucide-react";

import { Card, Empty, Kpi, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { configured, readPendingPurchaseOrders, readReceivingSessions, readOperationalExceptions, readPendingAllocations } from "@/lib/admin/data";

const STATUS_LABELS: Record<string, string> = {
  in_progress: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
};

const SEVERITY_CLS: Record<string, string> = {
  low: "bg-muted text-brand-ink-soft",
  medium: "bg-brand-orange/10 text-brand-orange",
  high: "bg-red-100 text-red-700",
  critical: "bg-red-200 text-red-900",
};

const TYPE_LABELS: Record<string, string> = {
  shortage: "Falta",
  damage: "Avaria",
  swap: "Troca",
  excess: "Excesso",
  late_delivery: "Atraso",
  other: "Outro",
};

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

export default async function RecebimentoPage() {
  if (!configured()) return <NotConfigured />;

  const [pendingPOs, sessions, exceptions, pendingAllocations] = await Promise.all([
    readPendingPurchaseOrders(),
    readReceivingSessions(),
    readOperationalExceptions("open"),
    readPendingAllocations(),
  ]);

  return (
    <>
      <PageTitle title="Recebimento no CD" subtitle="Conferência de pedidos de compra e exceções operacionais">
        <Link href="/admin/compras" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> Compras
        </Link>
      </PageTitle>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Kpi label="POs aguardando" value={String(pendingPOs.length)} tone="navy" />
        <Kpi label="Alocações pendentes" value={String(pendingAllocations.length)} tone={pendingAllocations.length > 0 ? "yellow" : "slate"} />
        <Kpi label="Sessões ativas" value={String(sessions.filter((s) => s.status === "in_progress").length)} tone="yellow" />
        <Kpi label="Concluídas" value={String(sessions.filter((s) => s.status === "completed").length)} tone="green" />
        <Kpi label="Exceções abertas" value={String(exceptions.length)} tone={exceptions.length > 0 ? "red" : "slate"} />
      </div>

      {/* Alocações pendentes de confirmação */}
      {pendingAllocations.length > 0 && (
        <Card title="Alocações pendentes de confirmação" className="mt-6">
          <p className="mb-3 text-sm text-brand-ink-soft">
            Recebimentos concluídos aguardando revisão e confirmação de alocação pelo admin.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Data ciclo</Th>
                <Th>Concluído em</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pendingAllocations.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <Td>{s.supplier_purchase_orders?.suppliers?.name ?? "—"}</Td>
                  <Td>{s.supplier_purchase_orders?.cycle_date ?? "—"}</Td>
                  <Td>{s.completed_at ? new Date(s.completed_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</Td>
                  <Td>
                    <Link
                      href={`/admin/recebimento/alocacao/${s.id}`}
                      className="inline-flex items-center gap-1 rounded bg-brand-orange px-3 py-1 text-xs font-medium text-white hover:bg-brand-orange/90"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" /> Revisar alocação
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* POs aguardando conferência */}
      <Card title="Pedidos de compra aguardando conferência" className="mt-6">
        {pendingPOs.length === 0 ? (
          <Empty>Nenhum pedido de compra aguardando conferência.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Data ciclo</Th>
                <Th>Itens</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pendingPOs.map((po) => (
                <tr key={po.id} className="border-t border-border">
                  <Td>{(po as Record<string, unknown>).suppliers ? ((po as Record<string, unknown>).suppliers as { name: string }).name : po.supplier_id}</Td>
                  <Td>{po.cycle_date}</Td>
                  <Td>{po.item_count}</Td>
                  <Td>{formatBRL(po.total_centavos)}</Td>
                  <Td><span className="rounded-full bg-brand-orange/10 px-2 py-0.5 text-xs font-medium text-brand-orange">{po.status}</span></Td>
                  <Td>
                    <Link
                      href={`/admin/recebimento/${po.id}`}
                      className="inline-flex items-center gap-1 rounded bg-brand-navy px-3 py-1 text-xs font-medium text-white hover:bg-brand-navy/90"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" /> Conferir
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Exceções abertas */}
      {exceptions.length > 0 && (
        <Card title="Exceções operacionais abertas" className="mt-6">
          <Table>
            <thead>
              <tr>
                <Th>Tipo</Th>
                <Th>Fornecedor</Th>
                <Th>Severidade</Th>
                <Th>Data</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exc) => (
                <tr key={exc.id} className="border-t border-border">
                  <Td><span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {TYPE_LABELS[exc.type] ?? exc.type}</span></Td>
                  <Td>{exc.suppliers?.name ?? exc.supplier_id ?? "—"}</Td>
                  <Td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CLS[exc.severity] ?? ""}`}>{exc.severity}</span></Td>
                  <Td>{new Date(exc.created_at).toLocaleDateString("pt-BR")}</Td>
                  <Td>{exc.resolution_status}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Sessões recentes */}
      <Card title="Sessões de recebimento recentes" className="mt-6">
        {sessions.length === 0 ? (
          <Empty>Nenhuma sessão de recebimento registrada.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Data ciclo</Th>
                <Th>Status</Th>
                <Th>Iniciado</Th>
                <Th>Concluído</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <Td>{s.supplier_purchase_orders?.suppliers?.name ?? "—"}</Td>
                  <Td>{s.supplier_purchase_orders?.cycle_date ?? "—"}</Td>
                  <Td><span className="text-xs font-medium">{STATUS_LABELS[s.status] ?? s.status}</span></Td>
                  <Td>{new Date(s.started_at).toLocaleDateString("pt-BR")}</Td>
                  <Td>{s.completed_at ? new Date(s.completed_at).toLocaleDateString("pt-BR") : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
