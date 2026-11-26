import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { assertSupplier } from "@/lib/supplier/guard";
import { getSupplierRequest } from "@/lib/supplier/data";
import { formatBRL } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/orders";
import { ConfirmationForm } from "./_confirmation-form";

export const metadata: Metadata = { title: "Confirmar pedido", robots: { index: false } };

function deadlineInfo(expiresAt: string | null): { label: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { label: "Prazo expirado", urgent: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { label: `${mins} min restante${mins !== 1 ? "s" : ""}`, urgent: mins <= 10 };
  const hours = Math.floor(mins / 60);
  return { label: `${hours}h${mins % 60 > 0 ? ` ${mins % 60}min` : ""} restante${hours !== 1 ? "s" : ""}`, urgent: false };
}

export default async function SupplierRequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const session = await assertSupplier();
  const result = await getSupplierRequest(requestId, session.supplierId);
  if (!result) notFound();
  const { request, lines, mirrors, claims } = result;

  const isPending = request.status === "aguardando_confirmacao";
  const isResolved = ["confirmado", "confirmado_parcial", "divergencia"].includes(request.status);
  const dl = isPending ? deadlineInfo(request.expires_at) : null;

  const claimsByItem = new Map(claims.map((c) => [c.order_item_id, c.qty_claimed]));

  const totalCentavos = lines.reduce((s, l) => s + l.quantity_requested * l.unit_cost_centavos, 0);

  return (
    <div>
      <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/fornecedores/pedidos" />}>
        <ArrowLeft /> Voltar aos pedidos
      </Button>

      <h1 className="mt-3 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">
        Confirmar disponibilidade
      </h1>
      <p className="mt-1 text-sm text-brand-ink-soft">
        {lines.length} {lines.length === 1 ? "item" : "itens"} · Total {formatBRL(totalCentavos / 100)}
        {request.responded_at ? ` · Confirmado em ${formatDateTime(request.responded_at)}` : ""}
      </p>

      {dl ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${dl.urgent ? "bg-brand-red/10 text-brand-red" : "bg-brand-orange-soft text-brand-orange"}`}>
            <Clock className="size-3.5" />
            {dl.label}
          </span>
        </div>
      ) : null}

      {isResolved ? (
        <div className="mt-6 rounded-2xl border border-brand-green/30 bg-brand-green-soft p-4">
          <p className="font-heading font-bold text-brand-green">Confirmação registrada</p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            Sua confirmação já foi enviada. Caso precise corrigir, entre em contato com a equipe de Compras.
          </p>
        </div>
      ) : null}

      {request.status === "expirado" ? (
        <div className="mt-6 rounded-2xl border border-brand-red/20 bg-brand-red/5 p-4">
          <p className="font-heading font-bold text-brand-red">Prazo expirado</p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            O prazo para confirmação desta solicitação expirou. A equipe de Compras foi notificada.
          </p>
        </div>
      ) : null}

      {request.status === "escalado" ? (
        <div className="mt-6 rounded-2xl border border-brand-orange/30 bg-brand-orange-soft p-4">
          <p className="font-heading font-bold text-brand-orange">
            <AlertTriangle className="mr-1 inline size-4" />
            Escalado para equipe
          </p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            Esta solicitação foi escalada para decisão manual da equipe de Compras.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <ConfirmationForm requestId={request.id} lines={lines} mirrors={mirrors} isPending={isPending} isResolved={isResolved} claimsByItem={claimsByItem} />
      </div>
    </div>
  );
}
