import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { OrderDetail } from "@/components/account/order-detail";
import { EconomicProtectionPanel } from "@/components/admin/economic-protection-panel";
import { FiscalStatusPanel } from "@/components/admin/fiscal-status-panel";
import { ItemFulfillmentPanel } from "@/components/admin/item-fulfillment-panel";
import { OrderActions } from "@/components/admin/order-actions";
import { ShipmentActionsPanel } from "@/components/admin/shipment-actions";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { listActiveDrivers } from "@/app/admin/actions";
import { adminGetOrder, adminGetItemFulfillmentSummary, configured } from "@/lib/admin/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/orders";

const EVENT_LABEL: Record<string, string> = {
  criado: "Pedido criado",
  status: "Status alterado",
  "pagamento-confirmado": "Pagamento confirmado",
  "pix-criado": "Pix gerado",
  "cartao-aprovado": "Cartão aprovado",
  "cartao-negado": "Cartão negado",
  webhook: "Notificação do gateway",
  estorno: "Estorno",
  arquivado: "Arquivado",
  reaberto: "Reaberto",
  cancelado: "Cancelado",
  desconsiderado: "Removido do fechamento",
  reconsiderado: "Devolvido ao fechamento",
  shipment_status_changed: "Entrega: status alterado",
  shipment_tracking_set: "Entrega: rastreio atualizado",
  shipment_occurrence: "Entrega: ocorrência",
  fiscal_doc_created: "Fiscal: documento criado",
  fiscal_doc_found_idempotent: "Fiscal: documento já existia",
  fiscal_doc_status_changed: "Fiscal: status alterado",
  fiscal_doc_invoiced: "Fiscal: DAV faturado",
  fiscal_doc_cancelled: "Fiscal: documento cancelado",
  fiscal_doc_send_failed: "Fiscal: falha no envio",
  fiscal_doc_sync_started: "Fiscal: sincronização iniciada",
  fiscal_doc_sync_completed: "Fiscal: sincronização concluída",
  result_protection_evaluated: "Proteção econômica avaliada",
  result_protection_resolved: "Proteção econômica: decisão tomada",
  complement_round_created: "Complemento: round criado",
  complement_round_limit_reached: "Complemento: limite de rounds atingido",
  item_complement_round_created: "Item: complemento criado",
  item_fulfilled: "Item: atendido pelo fornecedor",
  item_removed_fulfillment: "Item: removido (fulfillment)",
  result_lock_invalidated: "Resultado econômico invalidado (complemento)",
};

const ACTOR_LABEL: Record<string, string> = {
  system: "Sistema",
  admin: "Admin",
  customer: "Cliente",
  supplier: "Fornecedor",
  backend: "Sistema",
  webhook: "Gateway",
  cron: "Automação",
};

export default async function AdminOrder({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!configured()) return <NotConfigured />;
  const found = await adminGetOrder(code);
  if (!found) notFound();
  const { order, items, events, shipments, occurrences, fiscalDocs, resultLock, freightAllocations } = found;
  const [drivers, fulfillmentSummary, activeSuppliers] = await Promise.all([
    listActiveDrivers(),
    adminGetItemFulfillmentSummary(order.id),
    createAdminClient().from("suppliers").select("id, trade_name").eq("active", true).order("trade_name").then((r) => r.data ?? []),
  ]);

  return (
    <>
      <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/admin/pedidos" />}>
        <ArrowLeft /> Pedidos
      </Button>
      <PageTitle title={`Pedido ${order.code}`} subtitle={`${formatDateTime(order.created_at)} · origem ${order.origin ?? "site"}`} />

      <div className="space-y-6">
        <OrderActions order={order} />
        {order.order_status === "aguardando-pagamento" ? (
          <div className="rounded-xl border border-brand-yellow/40 bg-brand-yellow-soft px-4 py-2.5 text-sm text-brand-navy">
            Fornecedores confirmados — aguardando pagamento do cliente.
          </div>
        ) : null}
        <OrderDetail order={order} items={items} shipments={shipments} showCustomer />

        {fulfillmentSummary ? (
          <ItemFulfillmentPanel
            orderId={order.id}
            summary={fulfillmentSummary}
            suppliers={activeSuppliers}
          />
        ) : null}

        {shipments.length > 0 ? (
          <Card title="Entregas (gestão)">
            <div className="space-y-4">
              {shipments.map((s) => (
                <ShipmentActionsPanel
                  key={s.id}
                  shipment={s}
                  events={events}
                  occurrences={occurrences.filter((o) => o.shipment_id === s.id)}
                  drivers={drivers}
                />
              ))}
            </div>
          </Card>
        ) : null}

        <FiscalStatusPanel docs={fiscalDocs} />

        <EconomicProtectionPanel
          orderId={order.id}
          resultLock={resultLock}
          freightAllocations={freightAllocations}
        />

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
                      {EVENT_LABEL[e.type] ?? e.type} <span className="text-xs font-normal text-brand-ink-soft">({ACTOR_LABEL[e.actor_kind] ?? e.actor_kind})</span>
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
