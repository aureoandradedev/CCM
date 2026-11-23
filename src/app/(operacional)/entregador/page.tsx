import { readActiveShipments, readRecentShipments } from "@/lib/entregador/data";
import { EntregadorHome } from "./_home";

export default async function EntregadorPage() {
  const [active, recent] = await Promise.all([readActiveShipments(), readRecentShipments(5)]);
  return <EntregadorHome active={active} recent={recent} />;
}
