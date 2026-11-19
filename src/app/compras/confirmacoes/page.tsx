import { PageTitle } from "@/components/admin/ui";
import { adminOrdersAwaitingConfirmation } from "@/lib/admin/data";
import { ConfirmationList } from "./_confirmation-list";

export default async function ConfirmacoesPage() {
  const orders = await adminOrdersAwaitingConfirmation();

  return (
    <>
      <PageTitle
        title="Confirmação de pedidos"
        subtitle={`${orders.length} pedido(s) aguardando confirmação`}
      />
      <ConfirmationList orders={orders} />
    </>
  );
}
