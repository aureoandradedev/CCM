import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { readPODetail } from "@/lib/recebedor/data";
import { InspectionPanel } from "./_inspection-panel";

export default async function RecebedorPOPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const detail = await readPODetail(poId);
  if (!detail) notFound();

  const { po, items, session } = detail;

  return (
    <div className="space-y-4">
      <Link href="/recebedor" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink-soft hover:text-brand-navy">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>

      <div>
        <h1 className="font-heading text-base font-bold text-brand-navy">
          {po.supplier_name ?? po.supplier_id}
        </h1>
        <p className="text-xs text-brand-ink-soft">
          Ciclo: {po.cycle_date} · {items.length} {items.length === 1 ? "item" : "itens"}
        </p>
      </div>

      <InspectionPanel
        poId={poId}
        expectedItems={items.map((it) => ({
          id: it.id,
          masterProductId: it.master_product_id,
          name: it.product_name,
          expectedQty: it.quantity_units,
        }))}
        existingSessionId={session?.status === "in_progress" ? session.id : null}
      />
    </div>
  );
}
