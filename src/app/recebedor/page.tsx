import Link from "next/link";
import { ClipboardCheck, Package, Truck } from "lucide-react";

import { readPendingPOs, readRecentSessions } from "@/lib/recebedor/data";

const STATUS_LABEL: Record<string, string> = {
  sent: "Enviado",
  ready: "Pronto",
};

const SESSION_LABEL: Record<string, string> = {
  in_progress: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export default async function RecebedorPage() {
  const [pos, sessions] = await Promise.all([readPendingPOs(), readRecentSessions()]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-lg font-bold text-brand-navy">Conferência de Recebimento</h1>
        <p className="mt-0.5 text-xs text-brand-ink-soft">
          {pos.length === 0 ? "Nenhum pedido aguardando conferência." : `${pos.length} pedido${pos.length > 1 ? "s" : ""} aguardando conferência`}
        </p>
      </div>

      {/* PO Cards */}
      {pos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-brand-line bg-card py-12 text-center">
          <Package className="size-10 text-brand-ink-soft/40" />
          <p className="text-sm text-brand-ink-soft">Nenhum pedido de compra para conferir no momento.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pos.map((po) => (
            <Link
              key={po.id}
              href={`/recebedor/${po.id}`}
              className="block rounded-xl border border-brand-line bg-card p-4 shadow-sm active:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-bold text-brand-navy">
                    {po.supplier_name ?? po.supplier_id}
                  </p>
                  <p className="mt-0.5 text-xs text-brand-ink-soft">
                    Ciclo: {po.cycle_date} · {po.item_count} {po.item_count === 1 ? "item" : "itens"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-brand-orange/10 px-2 py-0.5 text-[0.65rem] font-semibold text-brand-orange">
                  {STATUS_LABEL[po.status] ?? po.status}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-end">
                {po.activeSession ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-brand-blue">
                    <Truck className="size-3.5" /> Em andamento
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-brand-navy">
                    <ClipboardCheck className="size-3.5" /> Conferir
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div>
          <h2 className="mb-2 font-heading text-sm font-bold text-brand-navy">Recentes</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-brand-line bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-ink">
                    {s.supplier_purchase_orders?.suppliers?.name ?? "—"}
                  </p>
                  <p className="text-[0.65rem] text-brand-ink-soft">
                    {new Date(s.started_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${
                  s.status === "completed" ? "bg-brand-green/10 text-brand-green" :
                  s.status === "in_progress" ? "bg-brand-blue/10 text-brand-blue" :
                  "bg-muted text-brand-ink-soft"
                }`}>
                  {SESSION_LABEL[s.status] ?? s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
