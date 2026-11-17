import Image from "next/image";
import { MapPin, Package, Truck } from "lucide-react";

import { formatDate, formatDateTime, methodLabel, paymentLabel, shipmentStatusLabel, statusLabel, TONE_CLASS, type OrderItemRow, type OrderRow, type OrderShipmentRow } from "@/lib/orders";
import { formatBRL, formatUnit } from "@/lib/utils/format";
import { maskDocument, maskPhone } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const s = statusLabel(status);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold", TONE_CLASS[s.tone])}>{s.label}</span>;
}
export function PaymentBadge({ status }: { status: string }) {
  const s = paymentLabel(status);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold", TONE_CLASS[s.tone])}>{s.label}</span>;
}
function ShipmentBadge({ status }: { status: string }) {
  const s = shipmentStatusLabel(status);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold", TONE_CLASS[s.tone])}>{s.label}</span>;
}

function ItemRow({ it }: { it: OrderItemRow }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
        {it.image ? <Image src={it.image} alt="" fill sizes="56px" className="object-cover" /> : <Package className="m-auto size-6 text-brand-ink-soft" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-medium text-brand-ink">{it.name}</p>
        <p className="text-xs text-brand-ink-soft">
          {it.qty} {formatUnit(it.unit)} × {formatBRL(it.unit_price_centavos / 100)}
          {it.price_tier === "wholesale" ? <span className="ml-1 rounded bg-brand-orange px-1 text-[0.6rem] font-bold uppercase text-white">Atacado</span> : null}
        </p>
      </div>
      <span className="font-heading font-bold text-brand-navy tabular-nums">{formatBRL(it.line_centavos / 100)}</span>
    </li>
  );
}

export function OrderDetail({ order, items, shipments = [], showCustomer = false }: { order: OrderRow; items: OrderItemRow[]; shipments?: OrderShipmentRow[]; showCustomer?: boolean }) {
  const hasMultipleShipments = shipments.length > 1;

  const itemsByShipment = new Map<string, OrderItemRow[]>();
  const unassigned: OrderItemRow[] = [];
  for (const it of items) {
    if (it.shipment_id) {
      const arr = itemsByShipment.get(it.shipment_id) ?? [];
      arr.push(it);
      itemsByShipment.set(it.shipment_id, arr);
    } else {
      unassigned.push(it);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {hasMultipleShipments ? (
          shipments.map((s) => {
            const shipItems = itemsByShipment.get(s.id) ?? [];
            return (
              <section key={s.id} className="rounded-2xl border border-brand-line bg-card">
                <div className="flex items-center gap-2 border-b border-brand-line px-4 py-3">
                  <Truck className="size-4 text-brand-navy" />
                  <span className="text-sm font-semibold text-brand-navy dark:text-foreground">Entrega {s.sequence}</span>
                  <ShipmentBadge status={s.status} />
                  <span className="ml-auto text-xs text-brand-ink-soft">
                    {s.promised_from && s.promised_to
                      ? `${formatDate(s.promised_from)} a ${formatDate(s.promised_to)}`
                      : "Prazo a confirmar"}
                  </span>
                </div>
                {s.tracking_code ? (
                  <div className="border-b border-brand-line px-4 py-2 text-xs text-brand-ink-soft">
                    Rastreio: <span className="font-mono font-semibold text-brand-ink">{s.tracking_code}</span>
                    {s.carrier ? ` · ${s.carrier}` : ""}
                  </div>
                ) : null}
                <ul className="divide-y divide-brand-line">
                  {shipItems.map((it) => <ItemRow key={it.id} it={it} />)}
                </ul>
              </section>
            );
          })
        ) : (
          <section className="rounded-2xl border border-brand-line bg-card">
            {shipments.length === 1 && shipments[0].promised_from && shipments[0].promised_to ? (
              <div className="flex items-center gap-2 border-b border-brand-line px-4 py-3">
                <Truck className="size-4 text-brand-navy" />
                <span className="text-sm font-semibold text-brand-navy dark:text-foreground">Entrega</span>
                <ShipmentBadge status={shipments[0].status} />
                <span className="ml-auto text-xs text-brand-ink-soft">
                  {formatDate(shipments[0].promised_from)} a {formatDate(shipments[0].promised_to)}
                </span>
              </div>
            ) : null}
            <ul className="divide-y divide-brand-line">
              {items.map((it) => <ItemRow key={it.id} it={it} />)}
            </ul>
          </section>
        )}
        {unassigned.length > 0 && hasMultipleShipments ? (
          <section className="rounded-2xl border border-brand-line bg-card">
            <ul className="divide-y divide-brand-line">
              {unassigned.map((it) => <ItemRow key={it.id} it={it} />)}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-brand-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.order_status} />
            <PaymentBadge status={order.payment_status} />
          </div>
          <dl className="mt-3 space-y-1.5">
            <div className="flex justify-between text-brand-ink-soft">
              <dt>Feito em</dt>
              <dd>{formatDateTime(order.created_at)}</dd>
            </div>
            <div className="flex justify-between text-brand-ink-soft">
              <dt>Pagamento</dt>
              <dd>{methodLabel(order.payment_method)}</dd>
            </div>
            {order.paid_at ? (
              <div className="flex justify-between text-brand-ink-soft">
                <dt>Pago em</dt>
                <dd>{formatDateTime(order.paid_at)}</dd>
              </div>
            ) : null}
          </dl>
          <dl className="mt-3 space-y-1.5 border-t border-brand-line pt-3">
            <div className="flex justify-between text-brand-ink-soft">
              <dt>Produtos</dt>
              <dd className="tabular-nums">{formatBRL(order.subtotal_centavos / 100)}</dd>
            </div>
            {order.wholesale_savings_centavos > 0 ? (
              <div className="flex justify-between text-brand-green">
                <dt>Economia no atacado</dt>
                <dd className="tabular-nums">- {formatBRL(order.wholesale_savings_centavos / 100)}</dd>
              </div>
            ) : null}
            {order.discount_centavos > 0 ? (
              <div className="flex justify-between text-brand-green">
                <dt>Desconto</dt>
                <dd className="tabular-nums">- {formatBRL(order.discount_centavos / 100)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-brand-ink-soft">
              <dt>Frete</dt>
              <dd className="tabular-nums">{order.freight_centavos ? formatBRL(order.freight_centavos / 100) : "Grátis"}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-brand-line pt-2">
              <dt className="font-heading font-bold text-brand-navy">Total</dt>
              <dd className="font-heading text-xl font-extrabold text-brand-navy tabular-nums">{formatBRL(order.total_centavos / 100)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-brand-line bg-card p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-brand-ink">
            <MapPin className="size-4 text-brand-navy" /> {order.delivery_method === "pickup" ? "Retirada no CD da CCM" : "Entrega pela CCM"}
          </p>
          {order.address ? (
            <p className="mt-1 text-brand-ink-soft">
              {order.address.street}, {order.address.number}
              {order.address.complement ? ` · ${order.address.complement}` : ""}
              <br />
              {order.address.district} · {order.address.city}/{order.address.state} · CEP {order.address.cep}
              {order.address.reference ? <><br />Ref.: {order.address.reference}</> : null}
            </p>
          ) : null}
          {order.notes ? <p className="mt-2 text-xs text-brand-ink-soft">Obs.: {order.notes}</p> : null}
          {showCustomer ? (
            <div className="mt-3 border-t border-brand-line pt-3 text-brand-ink-soft">
              <p className="font-semibold text-brand-ink">{order.customer.name}</p>
              <p>{maskDocument(order.customer.document)} · {maskPhone(order.customer.phone)}</p>
              <p>{order.customer.email}</p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
