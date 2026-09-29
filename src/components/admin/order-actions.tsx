"use client";

import Link from "next/link";
import { Archive, ArrowRight, Ban, CheckCircle2, EyeOff, MessageCircle, Printer, Receipt, RotateCcw, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { archiveOrder, cancelOrder, confirmPayment, excludeRevenue, moveOrder, reopenOrder, saveOrderNotes, type ActionResult } from "@/app/admin/actions";
import { textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { ORDER_STATUS, type OrderRow } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

const PROXIMO: Record<string, { to: string; label: string }[]> = {
  "aguardando-pagamento": [{ to: "em-separacao", label: "Mover para separação" }],
  "em-separacao": [
    { to: "separados", label: "Marcar separado / em entrega" },
    { to: "aguardando-pagamento", label: "Voltar p/ aguardando pagamento" },
  ],
  separados: [
    { to: "pagos", label: "Finalizar (entregue e pago)" },
    { to: "pagamento-pendente", label: "Entregue, pagamento pendente" },
    { to: "em-separacao", label: "Voltar p/ separação" },
  ],
  "pagamento-pendente": [{ to: "pagos", label: "Finalizar (recebido)" }],
  pagos: [{ to: "arquivados", label: "Arquivar" }],
  arquivados: [],
  cancelado: [],
};

/** Barra de ações do pedido no admin (mover status, confirmar, arquivar, estornar, imprimir, WhatsApp). */
export function OrderActions({ order }: { order: OrderRow }) {
  const [pending, start] = useTransition();
  const [motivo, setMotivo] = useState("");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [abrir, setAbrir] = useState<"desconsiderar" | "cancelar" | null>(null);

  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
      setAbrir(null);
      setMotivo("");
    });

  const estornar = () => {
    if (!window.confirm(`Estornar ${formatBRL(order.total_centavos / 100)} do pedido ${order.code} na Cielo? Esta ação não pode ser desfeita.`)) return;
    start(async () => {
      try {
        const r = await apiFetch<{ ok: boolean; status?: string; mensagem?: string }>("/pagamentos/estornar-pagamento", { body: { orderId: order.id } });
        toast.success(r.mensagem ?? `Estorno: ${r.status ?? "solicitado"}.`);
        window.location.reload();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  };

  const fone = (order.customer.phone || "").replace(/\D+/g, "");
  const zap = fone ? `https://wa.me/55${fone}?text=${encodeURIComponent(`Olá, ${order.customer.name.split(" ")[0]}! Sobre o seu pedido ${order.code} na Multigiro Central de Compras: `)}` : null;
  const pagoOnline = order.payment_status === "pago" && order.payment_provider && order.payment_provider !== "manual" && order.payment_provider !== "mock";

  return (
    <div className="no-print space-y-3 rounded-2xl border border-brand-line bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {PROXIMO[order.order_status]?.map((p) => (
          <Button key={p.to} variant={p.to === "pagos" || p.to === "separados" || p.to === "em-separacao" ? "navy" : "outline-navy"} size="sm" disabled={pending} onClick={() => go(() => moveOrder(order.id, p.to))}>
            <ArrowRight /> {p.label}
          </Button>
        ))}
        {order.payment_status !== "pago" && order.order_status !== "cancelado" ? (
          <Button variant="brand" size="sm" disabled={pending} onClick={() => go(() => confirmPayment(order.id))}>
            <CheckCircle2 /> Confirmar pagamento recebido
          </Button>
        ) : null}
        {order.order_status === "arquivados" ? (
          <Button variant="outline-navy" size="sm" disabled={pending} onClick={() => go(() => reopenOrder(order.id))}>
            <RotateCcw /> Reabrir
          </Button>
        ) : order.order_status !== "cancelado" && order.order_status !== "pagos" ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => go(() => archiveOrder(order.id))}>
            <Archive /> Arquivar
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" render={<Link href={`/admin/pedidos/${order.code}/imprimir`} target="_blank" />}>
          <Printer /> Imprimir pedido
        </Button>
        <Button variant="outline" size="sm" render={<Link href={`/admin/pedidos/${order.code}/imprimir?recibo=1`} target="_blank" />}>
          <Receipt /> Recibo
        </Button>
        {zap ? (
          <Button variant="whatsapp" size="sm" render={<a href={zap} target="_blank" rel="noreferrer" />}>
            <MessageCircle /> WhatsApp do cliente
          </Button>
        ) : null}
        {order.revenue_excluded ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => go(() => excludeRevenue(order.id, "", false))}>
            <Undo2 /> Voltar a considerar no faturamento
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setAbrir("desconsiderar")}>
            <EyeOff /> Desconsiderar no faturamento
          </Button>
        )}
        {pagoOnline && order.refund_status !== "estornado" ? (
          <Button variant="destructive" size="sm" disabled={pending} onClick={estornar}>
            <Undo2 /> Estornar pagamento
          </Button>
        ) : null}
        {order.order_status !== "cancelado" && order.payment_status !== "pago" ? (
          <Button variant="destructive" size="sm" disabled={pending} onClick={() => setAbrir("cancelar")}>
            <Ban /> Cancelar pedido
          </Button>
        ) : null}
      </div>

      {abrir ? (
        <div className="rounded-xl border border-brand-line bg-muted/40 p-3">
          <label className="block text-xs font-semibold text-brand-ink">
            {abrir === "desconsiderar" ? "Motivo para desconsiderar (teste, duplicado, erro...)" : "Motivo do cancelamento"}
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${textareaCls} mt-1 min-h-16`} />
          </label>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant={abrir === "cancelar" ? "destructive" : "navy"} disabled={pending || motivo.trim().length < 3} onClick={() => go(() => (abrir === "desconsiderar" ? excludeRevenue(order.id, motivo, true) : cancelOrder(order.id, motivo)))}>
              Confirmar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbrir(null)}>
              Voltar
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <label className="block text-xs font-semibold text-brand-ink">
          Observações internas / do cliente
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={`${textareaCls} mt-1 min-h-16`} />
        </label>
        <Button size="xs" variant="outline" className="mt-2" disabled={pending || notes === (order.notes ?? "")} onClick={() => go(() => saveOrderNotes(order.id, notes))}>
          Salvar observação
        </Button>
      </div>

      <p className="text-[0.7rem] text-brand-ink-soft">
        Fluxo: {Object.values(ORDER_STATUS).map((s) => s.label).slice(0, 4).join(" → ")}. Finalizados são arquivados automaticamente na limpeza (24 h).
      </p>
    </div>
  );
}

export function CleanupButton({ action }: { action: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Cancelar pedidos aguardando pagamento há mais de 24 h e arquivar finalizados há mais de 24 h?")) return;
        start(async () => {
          const r = await action();
          if (r.error) toast.error(r.error);
          else toast.success(r.ok ?? "Limpeza feita.");
        });
      }}
    >
      {pending ? "Limpando..." : "Limpar expirados"}
    </Button>
  );
}
