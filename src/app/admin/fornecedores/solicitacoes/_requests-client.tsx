"use client";

import { useState, useTransition } from "react";
import { Check, MessageSquare, X } from "lucide-react";

import { approveRegistration, rejectRegistration, requestCorrection, type RegistrationRequest } from "../invite-actions";
import { Button } from "@/components/ui/button";
import { maskCNPJ } from "@/lib/utils/masks";

const WEEKDAY_LABELS: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  approved: { label: "Aprovada", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Recusada", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  correction_requested: { label: "Correção solicitada", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
};

function StatusBadge({ status }: { status: string }) {
  const { label, cls } = STATUS_LABELS[status] ?? { label: status, cls: "bg-muted text-brand-ink-soft" };
  return <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold ${cls}`}>{label}</span>;
}

function RequestCard({ request, showActions }: { request: RegistrationRequest; showActions: boolean }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok?: string; error?: string }>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const handleApprove = () => {
    startTransition(async () => {
      const result = await approveRegistration(request.id);
      setFeedback(result);
    });
  };

  const handleReject = () => {
    startTransition(async () => {
      const result = await rejectRegistration(request.id, notes || undefined);
      setFeedback(result);
    });
  };

  const handleCorrection = () => {
    if (!notes.trim()) return;
    startTransition(async () => {
      const result = await requestCorrection(request.id, notes);
      setFeedback(result);
      setNotesOpen(false);
    });
  };

  return (
    <div className="rounded-2xl border border-brand-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">{request.name}</h3>
            <StatusBadge status={feedback.ok ? "approved" : request.status} />
          </div>
          <p className="text-xs text-brand-ink-soft">{request.trade_name} · {request.cnpj ? maskCNPJ(request.cnpj) : "sem CNPJ"}</p>
        </div>
        <p className="text-[0.65rem] text-brand-ink-soft">{new Date(request.created_at).toLocaleDateString("pt-BR")}</p>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div><span className="font-semibold text-brand-ink-soft">Cidade:</span> {request.city ?? "—"}{request.state ? ` / ${request.state}` : ""}</div>
        <div><span className="font-semibold text-brand-ink-soft">Contato:</span> {request.contact_name} {request.contact_phone ?? ""}</div>
        <div><span className="font-semibold text-brand-ink-soft">E-mail:</span> {request.contact_email ?? "—"}</div>
        <div><span className="font-semibold text-brand-ink-soft">Pedido mínimo:</span> {request.pedido_minimo_tipo === "valor" ? `R$ ${Number(request.pedido_minimo).toFixed(2)}` : `${request.pedido_minimo} un.`}</div>
        <div><span className="font-semibold text-brand-ink-soft">Dias de pedido:</span> {request.dias_pedido.sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(", ")}</div>
        <div><span className="font-semibold text-brand-ink-soft">Prazo entrega:</span> {request.prazo_entrega_cd_dias} dia(s)</div>
        <div><span className="font-semibold text-brand-ink-soft">Frete:</span> {request.frete_tipo === "fixo" ? `Fixo R$ ${Number(request.frete_valor ?? 0).toFixed(2)}` : `Grátis acima R$ ${Number(request.frete_gratis_acima ?? 0).toFixed(2)}, abaixo R$ ${Number(request.frete_valor ?? 0).toFixed(2)}`}</div>
        {request.supplier_id ? <div><span className="font-semibold text-brand-ink-soft">Fornecedor criado:</span> {request.supplier_id}</div> : null}
      </div>

      {request.admin_notes ? (
        <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-brand-ink-soft">
          <span className="font-semibold">Observação do admin:</span> {request.admin_notes}
        </div>
      ) : null}

      {feedback.ok ? (
        <p className="mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400">{feedback.ok}</p>
      ) : null}
      {feedback.error ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">{feedback.error}</p>
      ) : null}

      {showActions && !feedback.ok ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="navy" size="sm" onClick={handleApprove} disabled={pending}>
              <Check className="size-3.5" /> Aprovar e criar fornecedor
            </Button>
            <Button variant="outline" size="sm" onClick={() => setNotesOpen(!notesOpen)} disabled={pending}>
              <MessageSquare className="size-3.5" /> Solicitar correção
            </Button>
            <Button variant="outline" size="sm" onClick={handleReject} disabled={pending} className="text-red-600 hover:text-red-700">
              <X className="size-3.5" /> Recusar
            </Button>
          </div>
          {notesOpen ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observação para o fornecedor..."
                className="h-9 flex-1 rounded-lg border border-brand-line bg-background px-3 text-xs outline-none focus-visible:border-ring"
              />
              <Button variant="navy" size="sm" onClick={handleCorrection} disabled={!notes.trim() || pending}>
                Enviar
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RegistrationRequestsClient({ pending, others }: { pending: RegistrationRequest[]; others: RegistrationRequest[] }) {
  return (
    <div className="space-y-6">
      {pending.length === 0 ? (
        <p className="rounded-2xl border border-brand-line bg-card p-6 text-center text-sm text-brand-ink-soft">
          Nenhuma solicitação pendente.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.map((r) => <RequestCard key={r.id} request={r} showActions />)}
        </div>
      )}

      {others.length > 0 ? (
        <div>
          <h2 className="mb-3 font-heading text-sm font-bold text-brand-ink-soft">Histórico</h2>
          <div className="space-y-3">
            {others.map((r) => <RequestCard key={r.id} request={r} showActions={false} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
