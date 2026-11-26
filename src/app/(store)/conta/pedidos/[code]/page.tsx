import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AcceptAdjustments } from "@/components/account/accept-adjustments";
import { AcceptBackupDate } from "@/components/account/accept-backup-date";
import { CancelOrderButton } from "@/components/account/cancel-order-button";
import { ChoosePayment } from "@/components/account/choose-payment";
import { CustomerRemoveItem } from "@/components/account/customer-remove-item";
import { OrderDetail } from "@/components/account/order-detail";
import { PayNow } from "@/components/account/pay-now";
import { Button } from "@/components/ui/button";
import { getOrderByCode, getOrderCcmDisplay } from "@/lib/data/orders";
import { formatUnit } from "@/lib/utils/format";
import { getCurrentUser } from "@/lib/supabase/auth";
import type { CcmOrderDisplay, CcmItemDisplay, OrderItemRow } from "@/lib/orders";

export const metadata: Metadata = { title: "Detalhe do pedido", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/conta?next=/conta/pedidos/${code}`);
  const found = await getOrderByCode(code);
  if (!found) notFound();
  const { order, items, shipments } = found;
  const ccmInfo = await getOrderCcmDisplay(order.id);

  const aguardandoAceite = order.customer_acceptance_required === true && !order.customer_accepted_at && order.order_status === "aguardando-confirmacao";
  const escolherMetodo = order.order_status === "aguardando-pagamento" && order.payment_method == null;
  const podePagar = order.payment_status !== "pago" && order.order_status === "aguardando-pagamento" && order.payment_method != null && ["pix", "cartao-pendente", "cartao-credito", "cartao-debito"].includes(order.payment_method);
  const podeCancelar = order.payment_status !== "pago" && ["aguardando-confirmacao", "aguardando-pagamento"].includes(order.order_status);

  const ccmShortfallBanner = ccmInfo.enabled && ccmInfo.hasShortfall && order.order_status === "aguardando-confirmacao";
  const ccmReadyBanner = order.order_status === "aguardando-pagamento";
  const readyMsg = ccmReadyBanner ? getReadyMessage(ccmInfo) : null;

  return (
    <div>
      <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/conta/pedidos" />}>
        <ArrowLeft /> Meus pedidos
      </Button>
      <h1 className="mt-2 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Pedido {order.code}</h1>

      {ccmInfo.fetchError ? (
        <div className="mt-4 rounded-2xl border border-brand-line bg-muted p-4">
          <p className="text-sm text-brand-ink-soft">Não foi possível atualizar a disponibilidade deste pedido agora.</p>
        </div>
      ) : null}

      {ccmShortfallBanner ? (
        <div className="mt-4 rounded-2xl border border-brand-orange/30 bg-brand-orange-soft p-5">
          <p className="font-heading font-bold text-brand-navy">Ajustamos seu pedido antes do pagamento.</p>
          <p className="mt-1 text-sm text-brand-ink-soft">
            Parte dos itens não está mais disponível para entrega imediata. Estamos confirmando a quantidade restante antes de liberar o pagamento.
          </p>
          {ccmInfo.items.some((i) => i.ccmQty > 0 && i.supplierQty > 0) ? (
            <CcmItemBreakdown items={items} ccmItems={ccmInfo.items} />
          ) : null}
          <p className="mt-3 text-sm font-semibold text-brand-navy">Acompanhe o status — o pagamento será liberado em breve.</p>
        </div>
      ) : null}

      {aguardandoAceite && !ccmShortfallBanner ? (
        <div className="mt-4 space-y-4">
          <AcceptAdjustments orderId={order.id} items={items} />
          {items.every((i) => i.qty_confirmed == null || i.qty_confirmed === i.qty) && (
            <AcceptBackupDate orderId={order.id} />
          )}
        </div>
      ) : null}

      {ccmReadyBanner && readyMsg ? (
        <div className="mt-4 rounded-2xl border border-brand-green/30 bg-brand-green-soft p-4">
          <p className="text-sm font-semibold text-brand-green">{readyMsg.title}</p>
          <p className="mt-1 text-sm text-brand-ink-soft">{readyMsg.body}</p>
        </div>
      ) : null}

      {escolherMetodo ? (
        <div className="mt-4">
          <ChoosePayment orderId={order.id} orderCode={order.code} totalCentavos={order.total_centavos} pricingVersion={order.pricing_version} />
        </div>
      ) : null}

      {podePagar ? (
        <div className="mt-4">
          <PayNow orderId={order.id} orderCode={order.code} totalCentavos={order.total_centavos} pricingVersion={order.pricing_version} metodo={order.payment_method === "pix" ? "pix" : "cartao"} />
        </div>
      ) : null}

      {podeCancelar ? (
        <div className="mt-4 space-y-4">
          <CustomerRemoveItem orderId={order.id} items={items} />
          <CancelOrderButton orderId={order.id} />
        </div>
      ) : null}

      <div className="mt-6">
        <OrderDetail order={order} items={items} shipments={shipments} ccmInfo={ccmInfo} />
      </div>
    </div>
  );
}

function getReadyMessage(ccmInfo: CcmOrderDisplay): { title: string; body: string } {
  if (ccmInfo.enabled && ccmInfo.isCcmOnly && !ccmInfo.hasShortfall) {
    return { title: "Seu pedido está pronto para pagamento.", body: "Todos os itens estão disponíveis. Escolha a forma de pagamento para concluir." };
  }
  if (ccmInfo.enabled && ccmInfo.hasShortfall) {
    return { title: "Seu pedido está pronto para pagamento.", body: "Todos os itens foram confirmados. Agora falta apenas realizar o pagamento." };
  }
  return { title: "Os fornecedores confirmaram seu pedido.", body: "Agora falta apenas realizar o pagamento para continuarmos com a preparação." };
}

function CcmItemBreakdown({ items, ccmItems }: { items: OrderItemRow[]; ccmItems: CcmItemDisplay[] }) {
  const ccmMap = new Map(ccmItems.map((c) => [c.orderItemId, c]));
  const splits = items.filter((it) => {
    const c = ccmMap.get(it.id);
    return c && c.ccmQty > 0 && c.supplierQty > 0;
  });
  if (splits.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {splits.map((it) => {
        const c = ccmMap.get(it.id)!;
        const u = formatUnit(it.unit);
        return (
          <li key={it.id} className="text-sm text-brand-ink">
            <span className="font-medium">{it.name}</span>
            <span className="ml-2 text-brand-green">{c.ccmQty} {u} disponível</span>
            <span className="mx-1 text-brand-ink-soft">&middot;</span>
            <span className="text-brand-orange">{c.supplierQty} {u} em confirmação</span>
          </li>
        );
      })}
    </ul>
  );
}
