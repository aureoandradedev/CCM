import { PageTitle } from "@/components/admin/ui";
import { listEscalatedOrders } from "@/lib/admin/compras-data";
import { EscalationList } from "./_escalation-list";

export default async function EscalacoesPage() {
  const orders = await listEscalatedOrders();

  return (
    <>
      <PageTitle
        title="Escalações"
        subtitle={`${orders.length} pedido(s) precisando de decisão manual`}
        back="/compras"
      />
      <EscalationList orders={orders} />
    </>
  );
}
