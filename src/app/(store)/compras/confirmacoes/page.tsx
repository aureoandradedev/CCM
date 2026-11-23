import { PageTitle } from "@/components/admin/ui";
import { adminOrdersAwaitingConfirmation } from "@/lib/admin/data";
import { fetchRemindersForOrders } from "@/app/compras/actions";
import { ConfirmationList } from "./_confirmation-list";

export default async function ConfirmacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : "";
  const sortDir = sp.sort === "newest" ? "newest" : "oldest";

  const orders = await adminOrdersAwaitingConfirmation();
  const reminders = orders.length > 0
    ? await fetchRemindersForOrders(orders.map((o) => o.id))
    : {};

  return (
    <>
      <PageTitle
        title="Confirmação de pedidos"
        subtitle={`${orders.length} pedido(s) aguardando confirmação`}
      />
      <ConfirmationList
        orders={orders}
        reminders={reminders}
        initialSearch={search}
        initialSort={sortDir}
      />
    </>
  );
}
