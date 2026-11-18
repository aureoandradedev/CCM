import Link from "next/link";
import { CheckCircle, MapPin, Package, Truck } from "lucide-react";

import { readActiveShipments, readRecentShipments } from "@/lib/entregador/data";
import { SHIPMENT_STATUS_LABEL } from "@/lib/shipment-lifecycle";
import { formatDate, shipmentStatusLabel, TONE_CLASS } from "@/lib/orders";
import { cn } from "@/lib/utils";

export default async function EntregadorPage() {
  const [active, recent] = await Promise.all([readActiveShipments(), readRecentShipments(5)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-lg font-bold text-brand-navy">Minhas Entregas</h1>
        <p className="mt-0.5 text-xs text-brand-ink-soft">
          {active.length === 0
            ? "Nenhuma entrega atribuída no momento."
            : `${active.length} entrega${active.length > 1 ? "s" : ""} pendente${active.length > 1 ? "s" : ""}`}
        </p>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-brand-line bg-card py-12 text-center">
          <Truck className="size-10 text-brand-ink-soft/40" />
          <p className="text-sm text-brand-ink-soft">Nenhuma entrega atribuída a você no momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((s) => (
            <Link
              key={s.id}
              href={`/entregador/${s.id}`}
              className="block rounded-xl border border-brand-line bg-card p-4 shadow-sm active:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {s.delivery_method === "pickup" ? (
                      <MapPin className="size-4 shrink-0 text-brand-navy" />
                    ) : (
                      <Truck className="size-4 shrink-0 text-brand-navy" />
                    )}
                    <p className="truncate font-heading text-sm font-bold text-brand-navy">
                      {s.order_code} · {s.customer_name}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-brand-ink-soft">
                    Entrega {s.sequence} · {s.item_count} {s.item_count === 1 ? "item" : "itens"}
                    {s.promised_to ? ` · até ${formatDate(s.promised_to)}` : ""}
                  </p>
                  {s.address_district && (
                    <p className="mt-0.5 text-xs text-brand-ink-soft">
                      {s.address_district}
                    </p>
                  )}
                </div>
                <StatusBadge status={s.status} />
              </div>

              <div className="mt-3 flex items-center justify-end">
                <span className="flex items-center gap-1 text-xs font-semibold text-brand-navy">
                  {s.status === "enviado" ? (
                    <><CheckCircle className="size-3.5" /> Confirmar entrega</>
                  ) : (
                    <><Package className="size-3.5" /> Ver detalhes</>
                  )}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 font-heading text-sm font-bold text-brand-navy">Concluídas recentemente</h2>
          <div className="space-y-2">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/entregador/${s.id}`}
                className="flex items-center justify-between rounded-lg border border-brand-line bg-card px-4 py-3 active:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-ink">
                    {s.order_code} · {s.customer_name}
                  </p>
                  <p className="text-[0.65rem] text-brand-ink-soft">
                    Entrega {s.sequence} · {s.delivery_method === "pickup" ? "Retirada" : "Entrega"}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = shipmentStatusLabel(status);
  const short = SHIPMENT_STATUS_LABEL[status as keyof typeof SHIPMENT_STATUS_LABEL] ?? s.label;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold", TONE_CLASS[s.tone])}>
      {short}
    </span>
  );
}
