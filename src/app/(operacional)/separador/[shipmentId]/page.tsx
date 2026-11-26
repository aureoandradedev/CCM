import { notFound } from "next/navigation";

import { readShipmentDetail, readActiveDrivers, readDriverName } from "@/lib/separador/data";
import { SeparadorWorkflow } from "./_workflow";

export default async function SeparadorDetailPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const { shipmentId } = await params;
  const detail = await readShipmentDetail(shipmentId);
  if (!detail) notFound();

  const showDriverAssign =
    detail.delivery_method !== "pickup" &&
    (detail.status === "pronto_para_envio" || detail.status === "preparando");

  const [drivers, driverName] = showDriverAssign
    ? await Promise.all([
        readActiveDrivers(),
        detail.assigned_to ? readDriverName(detail.assigned_to) : Promise.resolve(null),
      ])
    : [[], null];

  return <SeparadorWorkflow detail={detail} drivers={drivers} driverName={driverName} />;
}
