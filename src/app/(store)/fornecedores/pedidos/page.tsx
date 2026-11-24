import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

import { assertSupplier } from "@/lib/supplier/guard";
import { listSupplierPOs } from "@/lib/supplier/data";
import { formatBRL } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/orders";

export const metadata: Metadata = { title: "Pedidos para confirmar", robots: { index: false } };

const STATUS_MAP: Record<string, { label: string; icon: typeof Clock; tone: string }> = {
  aguardando_confirmacao_fornecedor: { label: "Aguardando sua confirmação", icon: Clock, tone: "bg-brand-orange-soft text-brand-orange" },
  confirmado: { label: "Confirmado", icon: CheckCircle2, tone: "bg-brand-green-soft text-brand-green" },
  confirmado_parcial: { label: "Confirmado parcial", icon: AlertTriangle, tone: "bg-brand-yellow-soft text-brand-navy" },
  divergencia: { label: "Divergência", icon: AlertTriangle, tone: "bg-brand-red/10 text-brand-red" },
  revisao_necessaria: { label: "Em revisão", icon: ClipboardCheck, tone: "bg-muted text-brand-ink-soft" },
};

export default async function SupplierOrdersPage() {
  const session = await assertSupplier();
  const pos = await listSupplierPOs(session.supplierId);

  const pending = pos.filter((p) => p.supplier_confirmation_status === "aguardando_confirmacao_fornecedor");
  const resolved = pos.filter((p) => p.supplier_confirmation_status !== "aguardando_confirmacao_fornecedor");

  return (
    <div className="container-ccm pt-6 pb-16">
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Pedidos para confirmar</h1>
      <p className="mt-1 text-sm text-brand-ink-soft">Olá, {session.supplierName}. Confirme a disponibilidade dos itens abaixo.</p>

      {pending.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Aguardando sua confirmação ({pending.length})</h2>
          <div className="mt-3 space-y-3">
            {pending.map((po) => <POCard key={po.id} po={po} />)}
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
            {resolved.map((po) => <POCard key={po.id} po={po} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function POCard({ po }: { po: { id: string; cycle_date: string; item_count: number; total_centavos: number; supplier_confirmation_status: string; created_at: string } }) {
  const s = STATUS_MAP[po.supplier_confirmation_status] ?? STATUS_MAP.aguardando_confirmacao_fornecedor;
  const Icon = s.icon;
  return (
    <Link href={`/fornecedores/pedidos/${po.id}`} className="block rounded-2xl border border-brand-line bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading font-bold text-brand-navy">{po.item_count} {po.item_count === 1 ? "item" : "itens"} · {formatBRL(po.total_centavos / 100)}</p>
          <p className="mt-0.5 text-xs text-brand-ink-soft">Ciclo {po.cycle_date} · Criado em {formatDateTime(po.created_at)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.tone}`}>
          <Icon className="size-3.5" />
          {s.label}
        </span>
      </div>
    </Link>
  );
}
