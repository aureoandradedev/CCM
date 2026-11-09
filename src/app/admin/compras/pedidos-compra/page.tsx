import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, Kpi, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminPurchaseOrders, adminSuppliers, configured } from "@/lib/admin/data";
import { PurchaseOrderActions } from "./_actions-panel";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  confirmed: "Confirmado",
  partial: "Parcial",
  completed: "Concluído",
  cancelled: "Cancelado",
};

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
  const [orders, suppliers] = await Promise.all([
    adminPurchaseOrders(),
    adminSuppliers(),
  ]);

  const nameMap = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const drafts = orders.filter((o) => o.status === "draft");
  const belowMin = drafts.filter((o) => !o.minimum_met);
  const sent = orders.filter((o) => o.status === "sent");

  return (
    <>
      <Link
        href="/admin/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle title="Pedidos de compra" subtitle="Ciclos de compra por fornecedor" />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Rascunhos" value={String(drafts.length)} tone={drafts.length > 0 ? "yellow" : "slate"} />
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
                    {po.minimum_centavos != null ? ` de ${formatBRL(po.minimum_centavos)}` : ""}
                  </p>
                </div>
                <PurchaseOrderActions poId={po.id} status="draft" minimumMet={false} />
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
