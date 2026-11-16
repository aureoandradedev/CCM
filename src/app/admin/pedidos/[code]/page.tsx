import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { OrderDetail } from "@/components/account/order-detail";
import { OrderActions } from "@/components/admin/order-actions";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { adminGetOrder, configured } from "@/lib/admin/data";
import { formatDateTime } from "@/lib/orders";

const EVENT_LABEL: Record<string, string> = {
  criado: "Pedido criado",
  status: "Status alterado",
  "pagamento-confirmado": "Pagamento confirmado",
  "pix-criado": "Pix gerado",
  "cartao-aprovado": "Cartão aprovado",
  "cartao-negado": "Cartão negado",
  webhook: "Webhook",
  estorno: "Estorno",
  arquivado: "Arquivado",
  reaberto: "Reaberto",
  cancelado: "Cancelado",
  desconsiderado: "Removido do fechamento",
  reconsiderado: "Devolvido ao fechamento",
};

export default async function AdminOrder({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!configured()) return <NotConfigured />;
  const found = await adminGetOrder(code);
  if (!found) notFound();
  const { order, items, events } = found;

  return (
    <>
      <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/admin/pedidos" />}>
        <ArrowLeft /> Pedidos
      </Button>
      <PageTitle title={`Pedido ${order.code}`} subtitle={`${formatDateTime(order.created_at)} · origem ${order.origin ?? "site"}`} />

      <div className="space-y-6">
        <OrderActions order={order} />
        <OrderDetail order={order} items={items} showCustomer />

        <Card title="Pagamento (detalhes)">
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Row k="Provedor" v={order.payment_provider ?? "—"} />
            <Row k="ID Cielo" v={order.cielo_payment_id ?? "—"} mono />
            <Row k="Pix expira" v={order.pix_expires_at ? formatDateTime(order.pix_expires_at) : "—"} />
            <Row k="Estorno" v={order.refund_status ?? "—"} />
            <Row k="Fora do faturamento" v={order.revenue_excluded ? `Sim · ${order.revenue_excluded_reason ?? ""}` : "Não"} />
            <Row k="Versão de preço" v={String(order.pricing_version)} />
          </dl>
        </Card>

        <Card title="Histórico">
          {events.length ? (
            <ol className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 border-b border-brand-line pb-2 last:border-0">
                  <span className="w-36 shrink-0 text-xs text-brand-ink-soft">{formatDateTime(e.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-brand-ink">
                      {EVENT_LABEL[e.type] ?? e.type} <span className="text-xs font-normal text-brand-ink-soft">({e.actor_kind})</span>
                    </p>
                    {Object.keys(e.data ?? {}).length ? <p className="truncate text-xs text-brand-ink-soft">{JSON.stringify(e.data)}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-brand-ink-soft">Sem eventos.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-brand-ink-soft">{k}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>{v}</dd>
    </div>
  );
}
