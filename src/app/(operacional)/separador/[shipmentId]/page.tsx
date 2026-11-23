import { notFound } from "next/navigation";

import { readShipmentDetail } from "@/lib/separador/data";
import { SeparadorWorkflow } from "./_workflow";

export default async function SeparadorDetailPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const { shipmentId } = await params;
  const detail = await readShipmentDetail(shipmentId);
  if (!detail) notFound();

  return <SeparadorWorkflow detail={detail} />;
}
