import { notFound } from "next/navigation";

import { PageTitle } from "@/components/admin/ui";
import { adminOrderWithItemsForConfirmation } from "@/lib/admin/data";
import { formatDateTime, methodLabel } from "@/lib/orders";

import { PartialConfirmationForm } from "./_partial-form";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

export default async function ConfirmOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const result = await adminOrderWithItemsForConfirmation(orderId);
  if (!result) notFound();
  const { order, items } = result;

  return (
    <>
      <PageTitle
        title={`Confirmar ${order.code}`}
        subtitle={`${order.customer.name} · ${methodLabel(order.payment_method)} · ${order.delivery_method === "pickup" ? "Retirada" : "Entrega"} · ${formatDateTime(order.created_at)}`}
        back="/compras/confirmacoes"
      />

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-brand-line bg-card p-4 text-sm text-brand-ink-soft">
        <span>Subtotal original: <strong className="text-brand-ink">{formatBRL(order.subtotal_centavos)}</strong></span>
        <span>Frete: <strong className="text-brand-ink">{formatBRL(order.freight_centavos)}</strong></span>
        <span>Total original: <strong className="text-brand-ink">{formatBRL(order.total_centavos)}</strong></span>
        <span>{order.items_count} {order.items_count === 1 ? "item" : "itens"}</span>
      </div>

      <PartialConfirmationForm orderId={order.id} items={items} />
    </>
  );
}
