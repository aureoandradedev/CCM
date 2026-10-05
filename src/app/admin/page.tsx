import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { PaymentBadge, StatusBadge } from "@/components/account/order-detail";
import { Card, Empty, Kpi, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { adminDashboard, configured } from "@/lib/admin/data";
import { ORDER_STATUS, formatDateTime, methodLabel } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

const brl = (c: number) => formatBRL(c / 100);

export default async function AdminHome() {
  if (!configured()) {
    return (
      <>
        <PageTitle title="Painel" />
        <NotConfigured />
      </>
    );
  }
  const d = await adminDashboard();
  const hojeLabel = new Date(`${d.today}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  return (
    <>
      <PageTitle title="Painel" subtitle={hojeLabel.charAt(0).toUpperCase() + hojeLabel.slice(1)} />

      {d.campanhasAtrasadas.length ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-brand-orange/40 bg-brand-orange-soft px-4 py-3 text-sm text-brand-orange">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="flex-1">
            {d.campanhasAtrasadas.length} campanha(s) com horário de início já passado e ainda não ativada(s).{" "}
            <Link href="/admin/campanhas" className="font-bold underline">
              Ativar agora
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Vendido hoje" value={brl(d.hoje.vendido)} hint={`${d.hoje.orders.length} pedido(s)`} />
        <Kpi label="Recebido hoje" value={brl(d.hoje.recebido)} tone="green" />
        <Kpi label="Falta receber" value={brl(d.hoje.falta)} tone={d.hoje.falta ? "yellow" : "slate"} />
        <Kpi label="Faturamento do mês" value={brl(d.mesFaturamento)} hint={`${d.mesPedidos} pedido(s) pago(s)`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Últimos pedidos" action={<Link href="/admin/pedidos" className="inline-flex items-center gap-1 text-xs font-bold text-brand-navy hover:underline">Ver todos <ArrowRight className="size-3.5" /></Link>} className="[&>div]:p-0">
          {d.ultimos.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Pagamento</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {d.ultimos.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/50">
                    <Td>
                      <Link href={`/admin/pedidos/${o.code}`} className="font-heading font-bold text-brand-navy hover:underline">
                        {o.code}
                      </Link>
                      <p className="text-xs text-brand-ink-soft">{formatDateTime(o.created_at)}</p>
                    </Td>
                    <Td>
                      <p className="max-w-[220px] truncate">{o.customer.name}</p>
                    </Td>
                    <Td>
                      <p className="text-xs">{methodLabel(o.payment_method)}</p>
                      <PaymentBadge status={o.payment_status} />
                    </Td>
                    <Td>
                      <StatusBadge status={o.order_status} />
                    </Td>
                    <Td className="text-right font-bold tabular-nums">{brl(o.total_centavos)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5">
              <Empty>Nenhum pedido ainda.</Empty>
            </div>
          )}
        </Card>

        <Card title="Pedidos por status">
          <ul className="space-y-2 text-sm">
            {Object.entries(ORDER_STATUS).map(([k, v]) => (
              <li key={k}>
                <Link href={`/admin/pedidos?status=${k}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted">
                  <span>{v.label}</span>
                  <span className="font-heading font-bold text-brand-navy tabular-nums">{d.counts[k] ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
