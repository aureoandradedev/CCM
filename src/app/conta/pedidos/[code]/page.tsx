import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { OrderDetail } from "@/components/account/order-detail";
import { PayNow } from "@/components/account/pay-now";
import { Button } from "@/components/ui/button";
import { getOrderByCode } from "@/lib/data/orders";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Detalhe do pedido", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/conta?next=/conta/pedidos/${code}`);
  const found = await getOrderByCode(code);
  if (!found) notFound();
  const { order, items } = found;
  const podePagar = order.payment_status !== "pago" && order.order_status === "aguardando-pagamento" && ["pix", "cartao-pendente", "cartao-credito", "cartao-debito"].includes(order.payment_method);

  return (
    <div>
      <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/conta/pedidos" />}>
        <ArrowLeft /> Meus pedidos
      </Button>
      <h1 className="mt-2 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Pedido {order.code}</h1>

      {podePagar ? (
        <div className="mt-4">
          <PayNow orderId={order.id} orderCode={order.code} totalCentavos={order.total_centavos} pricingVersion={order.pricing_version} metodo={order.payment_method === "pix" ? "pix" : "cartao"} />
        </div>
      ) : null}

      <div className="mt-6">
        <OrderDetail order={order} items={items} />
      </div>
    </div>
  );
}
