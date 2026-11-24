import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { assertSupplier } from "@/lib/supplier/guard";
import { getSupplierRequest } from "@/lib/supplier/data";
import { formatBRL } from "@/lib/utils/format";
import { formatDateTime } from "@/lib/orders";
import { ConfirmationForm } from "./_confirmation-form";

export const metadata: Metadata = { title: "Confirmar pedido", robots: { index: false } };

export default async function SupplierRequestDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId: requestId } = await params;
  const session = await assertSupplier();
  const result = await getSupplierRequest(requestId, session.supplierId);
  if (!result) notFound();
  const { request, lines, mirrors } = result;

  const isPending = request.status === "aguardando_confirmacao";
  const isResolved = ["confirmado", "confirmado_parcial", "divergencia"].includes(request.status);

  const totalCentavos = lines.reduce((s, l) => s + l.quantity_requested * l.unit_cost_centavos, 0);

  return (
    <div className="container-ccm pt-6 pb-16">
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

      {isResolved ? (
        <div className="mt-6 rounded-2xl border border-brand-green/30 bg-brand-green-soft p-4">
          <p className="font-heading font-bold text-brand-green">Confirmação registrada</p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            Sua confirmação já foi enviada. Caso precise corrigir, entre em contato com a equipe de Compras.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <ConfirmationForm requestId={request.id} lines={lines} mirrors={mirrors} isPending={isPending} isResolved={isResolved} />
      </div>
    </div>
  );
}
