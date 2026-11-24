import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, Kpi, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminPurchaseOrders, adminSuppliers, configured, consolidateTodayPurchaseOrders } from "@/lib/admin/data";
import { PurchaseOrderActions } from "@/app/admin/compras/pedidos-compra/_actions-panel";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  ready: "Pronto",
  minimum_not_met: "Abaixo do mínimo",
  sent: "Enviado",
  confirmed: "Confirmado",
  partial: "Parcial",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const CONF_LABELS: Record<string, string> = {
  aguardando_confirmacao_fornecedor: "Aguardando fornecedor",
  confirmado: "Confirmado",
  confirmado_parcial: "Parcial",
  divergencia: "Divergência",
  revisao_necessaria: "Revisão necessária",
};

function confCls(status: string | null | undefined) {
  switch (status) {
    case "confirmado": return "bg-brand-green/10 text-brand-green";
    case "confirmado_parcial": return "bg-brand-orange/10 text-brand-orange";
    case "divergencia": return "bg-brand-red/10 text-brand-red";
    case "revisao_necessaria": return "bg-brand-red/10 text-brand-red";
    case "aguardando_confirmacao_fornecedor": return "bg-brand-yellow/10 text-brand-navy";
    default: return "bg-muted text-brand-ink-soft";
  }
}

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

function statusCls(status: string) {
  switch (status) {
    case "draft": return "bg-muted text-brand-ink-soft";
    case "sent": return "bg-brand-navy/10 text-brand-navy";
    case "confirmed": return "bg-brand-green/10 text-brand-green";
    case "completed": return "bg-brand-green/10 text-brand-green";
    case "cancelled": return "bg-muted text-brand-ink-soft";
    default: return "bg-brand-orange/10 text-brand-orange";
  }
}

export default async function PedidosCompraPage() {
  if (!configured()) return <NotConfigured />;

  await consolidateTodayPurchaseOrders();

  const [orders, suppliers] = await Promise.all([
    adminPurchaseOrders(),
    adminSuppliers(),
  ]);

  const nameMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const actionable = orders.filter((o) => ["draft", "ready", "minimum_not_met"].includes(o.status));
  const belowMin = orders.filter((o) => !o.minimum_met && ["draft", "minimum_not_met"].includes(o.status));
  const sent = orders.filter((o) => o.status === "sent");

  return (
    <>
      <Link
        href="/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle title="Pedidos de compra" subtitle="Ciclos de compra por fornecedor" />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Pendentes" value={String(actionable.length)} tone={actionable.length > 0 ? "yellow" : "slate"} />
        <Kpi label="Abaixo do mínimo" value={String(belowMin.length)} tone={belowMin.length > 0 ? "red" : "slate"} />
        <Kpi label="Enviados" value={String(sent.length)} tone={sent.length > 0 ? "green" : "slate"} />
        <Kpi label="Total" value={String(orders.length)} />
      </div>

      {belowMin.length > 0 && (
        <Card title="Mínimo não atingido" className="mb-6">
          {belowMin.map((po) => (
            <div key={po.id} className="mb-4 rounded-lg border border-brand-red/20 bg-brand-red/5 p-4 last:mb-0">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-brand-ink">{nameMap[po.supplier_id] ?? po.supplier_id}</p>
                  <p className="text-sm text-brand-ink-soft">
                    Ciclo: {new Date(po.cycle_date).toLocaleDateString("pt-BR")} · {formatBRL(po.total_centavos)}
                    {po.minimum_value != null ? ` (mín. ${po.minimum_type === "volume" ? `${po.minimum_value} un.` : formatBRL(po.minimum_value * 100)})` : ""}
                  </p>
                </div>
                <PurchaseOrderActions poId={po.id} status={po.status} minimumMet={po.minimum_met} />
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title="Todos os pedidos">
        {orders.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Ciclo</Th>
                <Th>Itens</Th>
                <Th>Total</Th>
                <Th>Frete</Th>
                <Th>Status</Th>
                <Th>Confirmação</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{nameMap[po.supplier_id] ?? po.supplier_id}</td>
                  <td className="px-3 py-2">{new Date(po.cycle_date).toLocaleDateString("pt-BR")}</td>
                  <td className="px-3 py-2 tabular-nums">{po.item_count}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(po.total_centavos)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(po.freight_centavos)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${statusCls(po.status)}`}>
                      {STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {po.supplier_confirmation_status ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${confCls(po.supplier_confirmation_status)}`}>
                        {CONF_LABELS[po.supplier_confirmation_status] ?? po.supplier_confirmation_status}
                      </span>
                    ) : (
                      <span className="text-xs text-brand-ink-soft">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PurchaseOrderActions poId={po.id} status={po.status} minimumMet={po.minimum_met} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">Nenhum pedido de compra gerado.</p>
        )}
      </Card>
    </>
  );
}
