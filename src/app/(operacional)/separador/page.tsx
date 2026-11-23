import { readActiveShipments, readRecentShipments } from "@/lib/separador/data";
import { SeparadorHome } from "./_home";

export default async function SeparadorPage() {
  const [active, recent] = await Promise.all([readActiveShipments(), readRecentShipments(5)]);
  return <SeparadorHome active={active} recent={recent} />;
}
