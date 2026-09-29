import Image from "next/image";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/admin/print-button";
import { adminGetOrder, configured } from "@/lib/admin/data";
import { formatDateTime, methodLabel, paymentLabel, statusLabel } from "@/lib/orders";
import { site } from "@/lib/site";
import { formatBRL, formatUnit } from "@/lib/utils/format";
import { maskDocument } from "@/lib/utils/masks";

/** Versão para impressão (pedido para separação ou recibo para o cliente). */
export default async function PrintOrder({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ recibo?: string }> }) {
  const { code } = await params;
  const { recibo } = await searchParams;
  if (!configured()) notFound();
  const found = await adminGetOrder(code);
  if (!found) notFound();
  const { order, items } = found;
  const isRecibo = recibo === "1";

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black print:p-0">
      <PrintButton />
      <header className="flex items-start justify-between border-b border-black/20 pb-4">
        <div className="flex items-center gap-3">
          <Image src="/brand/logo-multigiro.webp" alt="Multigiro" width={140} height={40} className="h-9 w-auto" />
          <div>
            <p className="font-heading text-lg font-extrabold">{site.fullName}</p>
            <p className="text-xs">{site.phone}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-heading text-2xl font-extrabold">{isRecibo ? "RECIBO" : "PEDIDO"} {order.code}</p>
          <p className="text-xs">{formatDateTime(order.created_at)}</p>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold uppercase text-black/60">Cliente</p>
          <p className="font-semibold">{order.customer.name}</p>
          <p>{maskDocument(order.customer.document)}</p>
          <p>{order.customer.phone}</p>
          {!isRecibo ? <p>{order.customer.email}</p> : null}
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-black/60">{order.delivery_method === "pickup" ? "Retirada" : "Entrega"}</p>
          {order.address ? (
            <p>
              {order.address.street}, {order.address.number} {order.address.complement}
              <br />
              {order.address.district} · {order.address.city}/{order.address.state}
              <br />
              CEP {order.address.cep}
              {order.address.reference ? <><br />Ref.: {order.address.reference}</> : null}
            </p>
          ) : (
            <p>Retirada no fornecedor</p>
          )}
        </div>
      </section>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/30 text-left text-xs uppercase">
            <th className="py-1">Item</th>
            {!isRecibo ? <th className="py-1">Fornecedor</th> : null}
            <th className="py-1 text-right">Qtd</th>
            <th className="py-1 text-right">Unit.</th>
            <th className="py-1 text-right">Total</th>
            {!isRecibo ? <th className="w-8 py-1 text-center">✓</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-black/10">
              <td className="py-1.5">
                {it.name}
                <span className="block text-xs text-black/60">{it.sku}</span>
              </td>
              {!isRecibo ? <td className="py-1.5 text-xs">{it.supplier_id ?? "—"}</td> : null}
              <td className="py-1.5 text-right tabular-nums">
                {it.qty} {formatUnit(it.unit)}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatBRL(it.unit_price_centavos / 100)}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{formatBRL(it.line_centavos / 100)}</td>
              {!isRecibo ? <td className="py-1.5 text-center"><span className="inline-block size-4 border border-black/50" /></td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 ml-auto w-72 space-y-1">
        <p className="flex justify-between"><span>Produtos</span><span className="tabular-nums">{formatBRL(order.subtotal_centavos / 100)}</span></p>
        {order.discount_centavos ? <p className="flex justify-between"><span>Desconto</span><span className="tabular-nums">- {formatBRL(order.discount_centavos / 100)}</span></p> : null}
        <p className="flex justify-between"><span>Frete</span><span className="tabular-nums">{order.freight_centavos ? formatBRL(order.freight_centavos / 100) : "Grátis"}</span></p>
        <p className="flex justify-between border-t border-black/30 pt-1 font-heading text-lg font-extrabold"><span>Total</span><span className="tabular-nums">{formatBRL(order.total_centavos / 100)}</span></p>
        <p className="text-xs">
          {methodLabel(order.payment_method)} · {paymentLabel(order.payment_status).label}
          {order.paid_at ? ` em ${formatDateTime(order.paid_at)}` : ""}
        </p>
        {!isRecibo ? <p className="text-xs">Status: {statusLabel(order.order_status).label}</p> : null}
      </section>

      {order.notes ? (
        <section className="mt-4 rounded border border-black/20 p-2 text-xs">
          <p className="font-bold">Observações</p>
          <p>{order.notes}</p>
        </section>
      ) : null}

      {isRecibo ? <p className="mt-8 text-center text-xs text-black/60">Recebemos do cliente acima o valor referente ao pedido {order.code}. Obrigado pela preferência!</p> : null}
    </div>
  );
}
