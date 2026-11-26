import { readActiveShipments, readRecentShipments } from "@/lib/entregador/data";
import { readActiveDrivers, type DriverOption } from "@/lib/separador/data";
import { requireRole } from "@/lib/admin/guard";
import { EntregadorHome } from "./_home";

export default async function EntregadorPage() {
  const user = await requireRole(["entregador"], "/entregador");
  const isAdmin = user.role === "admin";
  const [active, recent, drivers] = await Promise.all([
    readActiveShipments(),
    readRecentShipments(5),
    isAdmin ? readActiveDrivers() : ([] as DriverOption[]),
  ]);
  return <EntregadorHome active={active} recent={recent} drivers={drivers} />;
}
