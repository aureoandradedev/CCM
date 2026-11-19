"use client";

import { useState } from "react";
import { useActionState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

import { confirmOrder, rejectOrder, type ActionResult } from "@/app/compras/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime, methodLabel, statusLabel, TONE_CLASS } from "@/lib/orders";
import type { OrderRow } from "@/lib/orders";
import { cn } from "@/lib/utils";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

function OrderCard({ order }: { order: OrderRow }) {
  const [showReject, setShowReject] = useState(false);
  const [motivo, setMotivo] = useState("");

  const [, confirmAction, confirming] = useActionState(async () => {
    const r = await confirmOrder(order.id);
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, {} as ActionResult);

  const [, rejectAction, rejecting] = useActionState(async () => {
    if (motivo.trim().length < 3) { toast.error("Informe o motivo."); return {}; }
    const r = await rejectOrder(order.id, motivo.trim());
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, {} as ActionResult);

  const info = statusLabel(order.order_status);

  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-heading text-sm font-bold text-brand-navy">{order.code}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.6rem] font-semibold", TONE_CLASS[info.tone])}>
              {info.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-brand-ink">{order.customer.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
            <span>{formatBRL(order.total_centavos)}</span>
            <span>{methodLabel(order.payment_method)}</span>
            <span>{order.items_count} {order.items_count === 1 ? "item" : "itens"}</span>
            <span>{order.delivery_method === "pickup" ? "Retirada" : "Entrega"}</span>
            <span>{formatDateTime(order.created_at)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <form action={confirmAction}>
            <Button type="submit" variant="navy" size="sm" disabled={confirming || rejecting}>
              <CheckCircle className="size-4" /> Confirmar
            </Button>
          </form>
          <Button variant="outline" size="sm" onClick={() => setShowReject(!showReject)} disabled={confirming || rejecting}>
            <XCircle className="size-4" /> Rejeitar
          </Button>
        </div>
      </div>

      {showReject && (
        <form action={rejectAction} className="mt-3 flex items-end gap-2 border-t border-brand-line pt-3">
          <label className="flex-1">
            <span className="text-xs font-semibold text-brand-ink">Motivo da rejeição</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
              placeholder="Ex: produto indisponível"
              required
              minLength={3}
            />
          </label>
          <Button type="submit" variant="destructive" size="sm" disabled={rejecting || motivo.trim().length < 3}>
            Confirmar rejeição
          </Button>
        </form>
      )}
    </div>
  );
}

export function ConfirmationList({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-brand-line bg-muted/40 py-12 text-center">
        <CheckCircle className="mx-auto size-10 text-brand-green" />
        <p className="mt-3 font-heading text-sm font-bold text-brand-ink">Nenhum pedido aguardando confirmação</p>
        <p className="mt-1 text-xs text-brand-ink-soft">Novos pedidos aparecerão aqui automaticamente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}
    </div>
  );
}
