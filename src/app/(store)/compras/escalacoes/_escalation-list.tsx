"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Loader2, Shield, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EscalatedOrder, EscalatedRequest } from "@/lib/admin/compras-data";
import { formatDateTime } from "@/lib/orders";
import { resolveIntervention, manualActivateBackup, removeOrderItem, resolveEscalation } from "../actions";

const STATUS_LABELS: Record<string, string> = {
  escalado: "Escalado",
  expirado: "Expirado",
  aguardando_confirmacao: "Aguardando",
};

const ROLE_LABELS: Record<string, string> = {
  vencedor: "Preferencial",
  reserva: "Backup",
  manual: "Manual",
};

export function EscalationList({ orders }: { orders: EscalatedOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-brand-line bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-brand-green" />
        <p className="mt-3 font-heading text-lg font-bold text-brand-navy">Nenhuma escalação</p>
        <p className="mt-1 text-sm text-brand-ink-soft">Todos os pedidos estão sendo atendidos normalmente.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {orders.map((order) => (
        <OrderEscalationCard key={order.id} order={order} />
      ))}
    </div>
  );
}

function OrderEscalationCard({ order }: { order: EscalatedOrder }) {
  const [pending, startTransition] = useTransition();

  const handleResolve = () => {
    startTransition(async () => {
      const r = await resolveIntervention(order.id);
      if (r.error) toast.error(r.error);
      else toast.success(r.ok);
    });
  };

  return (
    <div className="rounded-2xl border border-brand-red/20 bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-brand-line p-5">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-brand-red" />
            <h3 className="font-heading text-lg font-bold text-brand-navy">{order.code}</h3>
          </div>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            {order.customer_name} · {formatDateTime(order.created_at)}
          </p>
        </div>
        <Button variant="outline-navy" size="sm" disabled={pending} onClick={handleResolve}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          Resolver intervenção
        </Button>
      </div>

      <div className="divide-y divide-brand-line">
        {order.requests.map((req) => (
          <RequestRow key={req.id} orderId={order.id} req={req} />
        ))}
      </div>
    </div>
  );
}

function RequestRow({ orderId, req }: { orderId: string; req: EscalatedRequest }) {
  const [action, setAction] = useState<"none" | "backup" | "remove">("none");
  const [reason, setReason] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [pending, startTransition] = useTransition();

  const handleBackup = () => {
    startTransition(async () => {
      const r = await manualActivateBackup(req.id, reason || "Decisão manual do Compras");
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        setAction("none");
      }
    });
  };

  const handleRemove = () => {
    if (!selectedItemId) return toast.error("Selecione um item.");
    startTransition(async () => {
      const r = await removeOrderItem(orderId, selectedItemId, reason || "Remoção manual pelo Compras");
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        setAction("none");
      }
    });
  };

  return (
    <div className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading font-bold text-brand-ink">{req.supplier_name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${req.status === "escalado" ? "bg-brand-red/10 text-brand-red" : "bg-muted text-brand-ink-soft"}`}>
          {STATUS_LABELS[req.status] || req.status}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${req.role === "vencedor" ? "bg-brand-green-soft text-brand-green" : req.role === "reserva" ? "bg-brand-yellow-soft text-brand-navy" : "bg-muted text-brand-ink-soft"}`}>
          <Shield className="mr-0.5 inline size-3" />
          {ROLE_LABELS[req.role] || req.role}
        </span>
      </div>

      {req.lines.length > 0 && (
        <div className="mt-3 space-y-1">
          {req.lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2 text-sm">
              <span className="text-brand-ink">{line.product_name}</span>
              <span className="text-brand-ink-soft">
                {line.quantity_confirmed != null ? `${line.quantity_confirmed}/${line.quantity_requested}` : line.quantity_requested} {line.unit || "un"}
              </span>
              {line.status && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${line.status === "indisponivel" ? "bg-brand-red/10 text-brand-red" : line.status === "confirmado" ? "bg-brand-green-soft text-brand-green" : "bg-muted text-brand-ink-soft"}`}>
                  {line.status}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {req.status === "escalado" && (
          <>
            <Button variant="outline-navy" size="sm" disabled={pending} onClick={() => {
              startTransition(async () => {
                const r = await resolveEscalation(req.id, "accept_partial", "");
                if (r.error) toast.error(r.error);
                else toast.success(r.ok);
              });
            }}>
              <CheckCircle2 /> Aceitar parcial
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => {
              startTransition(async () => {
                const r = await resolveEscalation(req.id, "cancel_items", "");
                if (r.error) toast.error(r.error);
                else toast.success(r.ok);
              });
            }}>
              <XCircle /> Cancelar itens
            </Button>
          </>
        )}
        {req.role === "vencedor" && !req.handoff_at && (
          <Button variant="outline-navy" size="sm" onClick={() => setAction(action === "backup" ? "none" : "backup")}>
            <ArrowRightLeft /> Ativar backup
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setAction(action === "remove" ? "none" : "remove")}>
          <Trash2 /> Remover item
        </Button>
      </div>

      {action === "backup" && (
        <div className="mt-3 rounded-xl border border-brand-line bg-muted/50 p-4">
          <p className="mb-2 text-sm font-medium text-brand-ink">Ativar fornecedor backup manualmente</p>
          <input
            className="mb-2 h-9 w-full rounded-lg border border-brand-line bg-card px-3 text-sm"
            placeholder="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={handleBackup}>
              {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
              Confirmar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAction("none")}>
              <XCircle /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {action === "remove" && (
        <div className="mt-3 rounded-xl border border-brand-line bg-muted/50 p-4">
          <p className="mb-2 text-sm font-medium text-brand-ink">Remover item do pedido</p>
          <select
            className="mb-2 h-9 w-full rounded-lg border border-brand-line bg-card px-3 text-sm"
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            <option value="">Selecione o item...</option>
            {req.lines.map((line) => (
              <option key={line.id} value={line.order_item_id}>{line.product_name} ({line.quantity_requested} {line.unit || "un"})</option>
            ))}
          </select>
          <input
            className="mb-2 h-9 w-full rounded-lg border border-brand-line bg-card px-3 text-sm"
            placeholder="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={pending || !selectedItemId} onClick={handleRemove}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Remover
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAction("none")}>
              <XCircle /> Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
