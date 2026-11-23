import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { OrderLookup } from "@/components/account/order-lookup";
import { PaymentBadge, StatusBadge } from "@/components/account/order-detail";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getMyOrders } from "@/lib/data/orders";
import { formatDateTime, methodLabel } from "@/lib/orders";
import { getCurrentUser } from "@/lib/supabase/auth";
import { formatBRL } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Meus pedidos", robots: { index: false } };

export default async function OrdersPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="container-ccm pt-4 md:pt-6">
        <Breadcrumbs items={[{ href: "/conta", label: "Minha conta" }, { label: "Acompanhar pedido" }]} />
        <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem]">Acompanhar pedido</h1>
        <p className="mt-2 max-w-xl text-sm text-brand-ink-soft">
          Digite o CPF ou CNPJ usado na compra e o número do pedido. Ou{" "}
          <Link href="/conta?next=/conta/pedidos" className="font-semibold text-brand-navy underline">
            entre na sua conta
          </Link>{" "}
          para ver todos.
        </p>
        <div className="mt-6">
          <OrderLookup />
        </div>
      </div>
    );
  }

  const orders = await getMyOrders();
  return (
    <div>
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Meus pedidos</h1>
      {orders.length ? (
        <ul className="mt-6 space-y-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/conta/pedidos/${o.code}`} className="lift flex items-center gap-4 rounded-2xl border border-brand-line bg-card p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-lg font-extrabold text-brand-navy">{o.code}</p>
                  <p className="text-xs text-brand-ink-soft">
                    {formatDateTime(o.created_at)} · {o.items_count} {o.items_count === 1 ? "item" : "itens"} · {methodLabel(o.payment_method)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={o.order_status} />
                    <PaymentBadge status={o.payment_status} />
                  </div>
                </div>
                <span className="font-heading text-xl font-extrabold text-brand-navy tabular-nums">{formatBRL(o.total_centavos / 100)}</span>
                <ChevronRight className="size-5 text-brand-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
          Nenhum pedido ainda.{" "}
          <Link href="/ofertas" className="font-semibold text-brand-navy underline">
            Ver ofertas
          </Link>
        </div>
      )}
    </div>
  );
}
