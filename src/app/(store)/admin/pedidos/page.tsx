import Link from "next/link";
import { Search } from "lucide-react";

import { PaymentBadge, StatusBadge } from "@/components/account/order-detail";
import { CleanupButton } from "@/components/admin/order-actions";
import { Chip, Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th, inputCls } from "@/components/admin/ui";
import { cleanupOrders } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { adminListOrders, adminOrderCounts, configured } from "@/lib/admin/data";
import { ORDER_STATUS, PAYMENT_METHOD_LABEL, formatDateTime, methodLabel } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";
import { maskDocument } from "@/lib/utils/masks";

type SP = Record<string, string | undefined>;

function href(sp: SP, patch: SP) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  u.delete("page");
  const s = u.toString();
  return `/admin/pedidos${s ? `?${s}` : ""}`;
}

export default async function AdminOrders({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const status = sp.status ?? "aguardando-pagamento";
  const [{ items, total }, counts] = await Promise.all([adminListOrders({ status, q: sp.q, de: sp.de, ate: sp.ate, pagamento: sp.pg, page }), adminOrderCounts()]);

  return (
    <>
      <PageTitle title="Pedidos" subtitle={`${total} pedido(s) nesta visão`}>
        <CleanupButton action={cleanupOrders} />
      </PageTitle>

      <form action="/admin/pedidos" className="mb-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="hidden" name="status" value={status} />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Código, nome, CPF/CNPJ, telefone ou e-mail" className={`${inputCls} pl-9`} />
        </div>
        <input type="date" name="de" defaultValue={sp.de ?? ""} className={inputCls} aria-label="De" />
        <input type="date" name="ate" defaultValue={sp.ate ?? ""} className={inputCls} aria-label="Até" />
        <select name="pg" defaultValue={sp.pg ?? ""} className={inputCls} aria-label="Forma de pagamento">
          <option value="">Todas as formas</option>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button type="submit" variant="navy">
          Filtrar
        </Button>
      </form>

      <div className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
        {Object.entries(ORDER_STATUS).map(([k, v]) => (
          <Chip key={k} href={href(sp, { status: k })} active={status === k}>
            {v.label} <span className="rounded-full bg-black/10 px-1.5 text-[0.65rem]">{counts[k] ?? 0}</span>
          </Chip>
        ))}
        <Chip href={href(sp, { status: "todos" })} active={status === "todos"}>
          Todos
        </Chip>
      </div>

      {items.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Pedido</Th>
              <Th>Cliente</Th>
              <Th>Entrega</Th>
              <Th>Pagamento</Th>
              <Th>Status</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className={o.revenue_excluded ? "bg-muted/40 hover:bg-muted/60" : "hover:bg-muted/50"}>
                <Td>
                  <Link href={`/admin/pedidos/${o.code}`} className="font-heading text-base font-bold text-brand-navy hover:underline">
                    {o.code}
                  </Link>
                  <p className="text-xs text-brand-ink-soft">{formatDateTime(o.created_at)}</p>
                  <p className="text-xs text-brand-ink-soft">{o.items_count} item(ns)</p>
                </Td>
                <Td>
                  <p className="max-w-[240px] truncate font-semibold">{o.customer.name}</p>
                  <p className="text-xs text-brand-ink-soft">
                    {maskDocument(o.customer.document)} · {o.customer.phone}
                  </p>
                </Td>
                <Td className="text-xs">
                  {o.delivery_method === "pickup" ? "Retirada" : o.address ? `${o.address.city}/${o.address.state}` : "Entrega"}
                  {o.supplier_ids?.length ? <p className="text-brand-ink-soft">{o.supplier_ids.join(", ")}</p> : null}
                </Td>
                <Td>
                  <p className="text-xs">{methodLabel(o.payment_method)}</p>
                  <PaymentBadge status={o.payment_status} />
                  {o.cash_pending ? <p className="text-[0.65rem] font-bold text-brand-orange">conferir caixa</p> : null}
                  {o.refund_status ? <p className="text-[0.65rem] font-bold text-brand-red">estorno: {o.refund_status}</p> : null}
                </Td>
                <Td>
                  <StatusBadge status={o.order_status} />
                  {o.revenue_excluded ? <p className="text-[0.65rem] text-brand-ink-soft">fora do faturamento</p> : null}
                </Td>
                <Td className="text-right font-bold text-brand-navy tabular-nums">{formatBRL(o.total_centavos / 100)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>Nenhum pedido nesta visão.</Empty>
      )}
      <Pagination page={page} total={total} perPage={50} href={(p) => `${href(sp, {})}${href(sp, {}).includes("?") ? "&" : "?"}page=${p}`} />
    </>
  );
}
