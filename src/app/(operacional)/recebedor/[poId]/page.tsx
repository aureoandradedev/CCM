import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { notFound } from "next/navigation";

import { readPODetail } from "@/lib/recebedor/data";
import { InspectionPanel } from "./_inspection-panel";

export default async function RecebedorPOPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const detail = await readPODetail(poId);
  if (!detail) notFound();

  const { po, items, session } = detail;

  return (
    <div className="space-y-5">
      <Link href="/recebedor" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-brand-navy">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-navy/10">
            <Package className="size-5 text-brand-navy" />
          </div>
          <div>
            <h1 className="font-heading text-base font-bold text-gray-900">
              {po.supplier_name ?? po.supplier_id}
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Ciclo {po.cycle_date} · {items.length} {items.length === 1 ? "item" : "itens"}
            </p>
          </div>
        </div>
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
