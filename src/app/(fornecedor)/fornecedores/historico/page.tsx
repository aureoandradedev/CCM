import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, ClipboardCheck, Clock } from "lucide-react";

import { assertSupplier } from "@/lib/supplier/guard";
import { listSupplierRequests } from "@/lib/supplier/data";
import { formatDateTime } from "@/lib/orders";

export const metadata: Metadata = { title: "Histórico" };

const STATUS_LABEL: Record<string, { label: string; icon: typeof Clock; tone: string }> = {
  aguardando_confirmacao: { label: "Pendente", icon: Clock, tone: "bg-brand-orange-soft text-brand-orange" },
  confirmado: { label: "Confirmado", icon: CheckCircle2, tone: "bg-brand-green-soft text-brand-green" },
  confirmado_parcial: { label: "Parcial", icon: AlertTriangle, tone: "bg-brand-yellow-soft text-brand-navy" },
  divergencia: { label: "Divergência", icon: AlertTriangle, tone: "bg-brand-red/10 text-brand-red" },
  revisao_necessaria: { label: "Em revisão", icon: ClipboardCheck, tone: "bg-muted text-brand-ink-soft" },
};

export default async function SupplierHistoricoPage() {
  const session = await assertSupplier();
  const requests = await listSupplierRequests(session.supplierId);

  const resolved = requests.filter((r) => r.status !== "aguardando_confirmacao");

  return (
    <div>
      <h1 className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy">Histórico</h1>
      <p className="mt-1 text-sm text-brand-ink-soft">Solicitações já respondidas.</p>

      {resolved.length > 0 ? (
        <div className="mt-6 space-y-3">
          {resolved.map((req) => {
            const s = STATUS_LABEL[req.status] ?? STATUS_LABEL.confirmado;
            const Icon = s.icon;
            return (
              <Link
                key={req.id}
                href={`/fornecedores/pedidos/${req.id}`}
                className="block rounded-2xl border border-brand-line bg-card p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading font-bold text-brand-navy">Solicitação de confirmação</p>
                    <p className="mt-0.5 text-xs text-brand-ink-soft">
                      Criado em {formatDateTime(req.created_at)}
                      {req.responded_at ? ` · Respondido em ${formatDateTime(req.responded_at)}` : ""}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.tone}`}>
                    <Icon className="size-3.5" />
                    {s.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-brand-line bg-card p-8 text-center">
          <ClipboardCheck className="mx-auto size-10 text-brand-ink-soft" />
          <p className="mt-3 font-heading text-lg font-bold text-brand-navy">Nenhum histórico</p>
          <p className="mt-1 text-sm text-brand-ink-soft">Suas confirmações aparecerão aqui após serem respondidas.</p>
        </div>
      )}
    </div>
  );
}
