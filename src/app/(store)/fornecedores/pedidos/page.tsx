import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

import { assertSupplier } from "@/lib/supplier/guard";
import { listSupplierRequests } from "@/lib/supplier/data";
import { formatDateTime } from "@/lib/orders";

export const metadata: Metadata = { title: "Pedidos para confirmar", robots: { index: false } };

const STATUS_MAP: Record<string, { label: string; icon: typeof Clock; tone: string }> = {
  aguardando_confirmacao: { label: "Aguardando sua confirmação", icon: Clock, tone: "bg-brand-orange-soft text-brand-orange" },
  confirmado: { label: "Confirmado", icon: CheckCircle2, tone: "bg-brand-green-soft text-brand-green" },
  confirmado_parcial: { label: "Confirmado parcial", icon: AlertTriangle, tone: "bg-brand-yellow-soft text-brand-navy" },
  divergencia: { label: "Divergência", icon: AlertTriangle, tone: "bg-brand-red/10 text-brand-red" },
  revisao_necessaria: { label: "Em revisão", icon: ClipboardCheck, tone: "bg-muted text-brand-ink-soft" },
};

export default async function SupplierOrdersPage() {
  const session = await assertSupplier();
  const requests = await listSupplierRequests(session.supplierId);

  const pending = requests.filter((r) => r.status === "aguardando_confirmacao");
  const resolved = requests.filter((r) => r.status !== "aguardando_confirmacao");

  return (
    <div className="container-ccm pt-6 pb-16">
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Pedidos para confirmar</h1>
      <p className="mt-1 text-sm text-brand-ink-soft">Olá, {session.supplierName}. Confirme a disponibilidade dos itens abaixo.</p>

      {pending.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Aguardando sua confirmação ({pending.length})</h2>
          <div className="mt-3 space-y-3">
            {pending.map((req) => <RequestCard key={req.id} req={req} />)}
          </div>
        </section>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-brand-line bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto size-10 text-brand-green" />
          <p className="mt-3 font-heading text-lg font-bold text-brand-navy">Tudo confirmado!</p>
          <p className="mt-1 text-sm text-brand-ink-soft">Não há pedidos pendentes de confirmação.</p>
        </div>
      )}

      {resolved.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Já confirmados ({resolved.length})</h2>
          <div className="mt-3 space-y-3">
            {resolved.map((req) => <RequestCard key={req.id} req={req} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RequestCard({ req }: { req: { id: string; status: string; created_at: string; sent_at: string } }) {
  const s = STATUS_MAP[req.status] ?? STATUS_MAP.aguardando_confirmacao;
  const Icon = s.icon;
  return (
    <Link href={`/fornecedores/pedidos/${req.id}`} className="block rounded-2xl border border-brand-line bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading font-bold text-brand-navy">Solicitação de confirmação</p>
          <p className="mt-0.5 text-xs text-brand-ink-soft">Criado em {formatDateTime(req.created_at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.tone}`}>
          <Icon className="size-3.5" />
          {s.label}
        </span>
      </div>
    </Link>
  );
}
