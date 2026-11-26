import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Clock, CheckCircle2, ArrowRight } from "lucide-react";

import { assertSupplier } from "@/lib/supplier/guard";
import { listSupplierRequests } from "@/lib/supplier/data";

export const metadata: Metadata = { title: "Painel" };

export default async function SupplierDashboardPage() {
  const session = await assertSupplier();
  const requests = await listSupplierRequests(session.supplierId);

  const pending = requests.filter((r) => r.status === "aguardando_confirmacao");
  const resolved = requests.filter((r) => r.status !== "aguardando_confirmacao");

  return (
    <div>
      <h1 className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy">
        Bem-vindo, {session.supplierName}
      </h1>
      <p className="mt-1 text-sm text-brand-ink-soft">Resumo do seu portal de fornecedor.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <KpiCard icon={Clock} label="Aguardando sua confirmação" value={pending.length} tone="text-brand-orange" bg="bg-brand-orange-soft" />
        <KpiCard icon={CheckCircle2} label="Confirmados" value={resolved.length} tone="text-brand-green" bg="bg-brand-green-soft" />
        <KpiCard icon={ClipboardList} label="Total de solicitações" value={requests.length} tone="text-brand-navy" bg="bg-brand-navy/10" />
      </div>

      {pending.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-brand-navy">Pendentes</h2>
            <Link href="/fornecedores/pedidos" className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline">
              Ver todas <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {pending.slice(0, 5).map((req) => (
              <Link
                key={req.id}
                href={`/fornecedores/pedidos/${req.id}`}
                className="flex items-center justify-between rounded-xl border border-brand-line bg-card px-4 py-3 transition-shadow hover:shadow-md"
              >
                <span className="text-sm font-medium text-brand-navy">Solicitação de confirmação</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-orange-soft px-2.5 py-0.5 text-xs font-semibold text-brand-orange">
                  <Clock className="size-3" /> Pendente
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-brand-line bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto size-10 text-brand-green" />
          <p className="mt-3 font-heading text-lg font-bold text-brand-navy">Nenhuma pendência</p>
          <p className="mt-1 text-sm text-brand-ink-soft">Todas as solicitações foram respondidas. Bom trabalho!</p>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone, bg }: { icon: typeof Clock; label: string; value: number; tone: string; bg: string }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-5">
      <div className={`inline-flex size-10 items-center justify-center rounded-xl ${bg}`}>
        <Icon className={`size-5 ${tone}`} />
      </div>
      <p className="mt-3 font-heading text-2xl font-extrabold text-brand-navy">{value}</p>
      <p className="mt-0.5 text-sm text-brand-ink-soft">{label}</p>
    </div>
  );
}
