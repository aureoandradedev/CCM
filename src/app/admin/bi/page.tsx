import Link from "next/link";

import { Card, Chip, Empty, Kpi, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { adminDailyRevenue, adminRevenueExcluded, configured, todaySP } from "@/lib/admin/data";
import { formatDateTime } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

const brl = (c: number) => formatBRL(c / 100);
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default async function AdminBI({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string }> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const hoje = todaySP();
  const ano = Number(sp.ano) || Number(hoje.slice(0, 4));
  const mes = sp.mes === "todos" ? undefined : Number(sp.mes) || Number(hoje.slice(5, 7));
  const [dias, excluidos] = await Promise.all([adminDailyRevenue(ano, mes), adminRevenueExcluded(50)]);

  const total = dias.reduce((a, d) => a + d.faturamento_centavos, 0);
  const vendido = dias.reduce((a, d) => a + d.vendido_centavos, 0);
  const pedidosPagos = dias.reduce((a, d) => a + d.pedidos_pagos, 0);
  const pedidos = dias.reduce((a, d) => a + d.pedidos, 0);
  const ticket = pedidosPagos ? total / pedidosPagos : 0;
  const maxDia = Math.max(1, ...dias.map((d) => d.faturamento_centavos));

  // visão por mês quando "todos"
  const porMes = new Map<number, { fat: number; ped: number }>();
  if (!mes) for (const d of dias) {
    const m = Number(d.dia.slice(5, 7));
    const cur = porMes.get(m) ?? { fat: 0, ped: 0 };
    cur.fat += d.faturamento_centavos;
    cur.ped += d.pedidos_pagos;
    porMes.set(m, cur);
  }

  return (
    <>
      <PageTitle title="Faturamento" subtitle="Pedidos pagos, excluindo os que estão fora do fechamento. Vendido = todos os pedidos (exceto cancelados)." />

      <div className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
        {[ano - 2, ano - 1, ano, ano + (ano < Number(hoje.slice(0, 4)) ? 1 : 0)]
          .filter((a, i, arr) => arr.indexOf(a) === i && a <= Number(hoje.slice(0, 4)))
          .map((a) => (
            <Chip key={a} href={`/admin/bi?ano=${a}&mes=${mes ?? "todos"}`} active={a === ano}>
              {a}
            </Chip>
          ))}
        <span className="mx-1 w-px bg-brand-line" />
        <Chip href={`/admin/bi?ano=${ano}&mes=todos`} active={!mes}>
          Ano inteiro
        </Chip>
        {MESES.map((m, i) => (
          <Chip key={m} href={`/admin/bi?ano=${ano}&mes=${i + 1}`} active={mes === i + 1}>
            {m}
          </Chip>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Faturamento" value={brl(total)} tone="green" hint={`${pedidosPagos} pedido(s) pago(s)`} />
        <Kpi label="Vendido (bruto)" value={brl(vendido)} hint={`${pedidos} pedido(s)`} />
        <Kpi label="Ticket médio" value={brl(ticket)} />
        <Kpi label="Conversão de pagamento" value={pedidos ? `${Math.round((pedidosPagos / pedidos) * 100)}%` : "—"} tone="slate" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title={mes ? `Por dia · ${MESES[mes - 1]}/${ano}` : `Por mês · ${ano}`}>
          {dias.length ? (
            mes ? (
              <ul className="space-y-1.5">
                {dias.map((d) => (
                  <li key={d.dia} className="grid grid-cols-[64px_1fr_110px] items-center gap-3 text-sm">
                    <Link href={`/admin/caixa?dia=${d.dia}`} className="text-xs font-semibold text-brand-navy hover:underline">
                      {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                    </Link>
                    <div className="h-4 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-brand-navy" style={{ width: `${Math.max(2, (d.faturamento_centavos / maxDia) * 100)}%` }} />
                    </div>
                    <span className="text-right font-bold tabular-nums">{brl(d.faturamento_centavos)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Table className="border-0">
                <thead>
                  <tr>
                    <Th>Mês</Th>
                    <Th className="text-right">Pedidos pagos</Th>
                    <Th className="text-right">Faturamento</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...porMes.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => (
                    <tr key={m}>
                      <Td>
                        <Link href={`/admin/bi?ano=${ano}&mes=${m}`} className="font-semibold text-brand-navy hover:underline">
                          {MESES[m - 1]}
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{v.ped}</Td>
                      <Td className="text-right font-bold tabular-nums">{brl(v.fat)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          ) : (
            <Empty>Sem vendas no período.</Empty>
          )}
        </Card>

        <Card title="Fora do fechamento">
          {excluidos.length ? (
            <ul className="space-y-2 text-sm">
              {excluidos.map((o) => (
                <li key={o.id} className="border-b border-brand-line pb-2 last:border-0">
                  <Link href={`/admin/pedidos/${o.code}`} className="font-heading font-bold text-brand-navy hover:underline">
                    {o.code}
                  </Link>{" "}
                  <span className="tabular-nums">{brl(o.total_centavos)}</span>
                  <p className="text-xs text-brand-ink-soft">
                    {formatDateTime(o.created_at)} · {o.revenue_excluded_reason}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-brand-ink-soft">Nenhum pedido fora do fechamento.</p>
          )}
        </Card>
      </div>
    </>
  );
}
