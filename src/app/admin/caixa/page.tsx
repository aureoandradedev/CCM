import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { PaymentBadge, StatusBadge } from "@/components/account/order-detail";
import { CashTools } from "@/components/admin/cash-tools";
import { Card, Chip, Empty, Kpi, NotConfigured, PageTitle, Table, Td, Th, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { adminCash, configured, todaySP } from "@/lib/admin/data";
import { formatDateTime, methodLabel } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

const brl = (c: number) => formatBRL(c / 100);

function shift(day: string, n: number) {
  const d = new Date(`${day}T12:00:00-03:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export default async function AdminCash({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const { dia } = await searchParams;
  if (!configured()) return <NotConfigured />;
  const hoje = todaySP();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dia ?? "") ? (dia as string) : hoje;
  const s = await adminCash(day);
  const label = new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <PageTitle title="Fechamento de caixa" subtitle={label.charAt(0).toUpperCase() + label.slice(1)}>
        <CashTools summary={s} />
      </PageTitle>

      <form action="/admin/caixa" className="mb-4 flex flex-wrap items-center gap-2">
        <Chip href={`/admin/caixa?dia=${shift(day, -1)}`}>‹ Dia anterior</Chip>
        <input type="date" name="dia" defaultValue={day} max={hoje} className={`${inputCls} w-44`} />
        <Button type="submit" variant="navy" size="sm">
          Ver
        </Button>
        {day !== hoje ? <Chip href={`/admin/caixa?dia=${shift(day, 1)}`}>Dia seguinte ›</Chip> : null}
        {day !== hoje ? <Chip href="/admin/caixa">Hoje</Chip> : null}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Vendido" value={brl(s.vendido)} hint={`${s.orders.filter((o) => !o.revenue_excluded).length} pedido(s)`} />
        <Kpi label="Recebido" value={brl(s.recebido)} tone="green" />
        <Kpi label="Falta receber" value={brl(s.falta)} tone={s.falta ? "yellow" : "slate"} />
        <Kpi label="Desconsiderados" value={brl(s.desconsiderados)} tone="slate" hint="Testes, duplicados, erros" />
      </div>

      {s.duplicados.length ? (
        <div className="mt-6 rounded-2xl border border-brand-orange/40 bg-brand-orange-soft p-4 text-sm text-brand-orange">
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4" /> Possíveis duplicados (mesmo documento e total em até 30 min)
          </p>
          <ul className="mt-2 space-y-1">
            {s.duplicados.map((g) => (
              <li key={g[0].id}>
                {g.map((o) => (
                  <Link key={o.id} href={`/admin/pedidos/${o.code}`} className="mr-2 font-heading font-bold underline">
                    {o.code}
                  </Link>
                ))}
                <span className="text-xs">· {g[0].customer.name} · {brl(g[0].total_centavos)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Por forma de pagamento">
          {s.porMetodo.length ? (
            <ul className="space-y-2 text-sm">
              {s.porMetodo.map((m) => (
                <li key={m.metodo} className="flex items-center justify-between">
                  <span>
                    {methodLabel(m.metodo)} <span className="text-xs text-brand-ink-soft">×{m.qtd}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="font-bold text-brand-navy">{brl(m.total)}</span>
                    <span className="block text-xs text-brand-green">recebido {brl(m.recebido)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-brand-ink-soft">Sem vendas neste dia.</p>
          )}
        </Card>

        <div>
          {s.orders.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Forma</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {s.orders.map((o) => (
                  <tr key={o.id} className={o.revenue_excluded ? "bg-muted/40 line-through opacity-70" : "hover:bg-muted/50"}>
                    <Td>
                      <Link href={`/admin/pedidos/${o.code}`} className="font-heading font-bold text-brand-navy hover:underline">
                        {o.code}
                      </Link>
                      <p className="text-xs text-brand-ink-soft">{formatDateTime(o.created_at).slice(-5)}</p>
                    </Td>
                    <Td className="max-w-[220px] truncate">{o.customer.name}</Td>
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
            <Empty>Nenhum pedido neste dia.</Empty>
          )}
        </div>
      </div>
    </>
  );
}
