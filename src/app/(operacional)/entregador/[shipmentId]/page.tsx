import { notFound } from "next/navigation";

import { readShipmentDetail } from "@/lib/entregador/data";
import { EntregadorWorkflow } from "./_workflow";

export default async function EntregadorDetailPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const { shipmentId } = await params;
  const detail = await readShipmentDetail(shipmentId);
  if (!detail) notFound();

  return <EntregadorWorkflow detail={detail} />;
}
