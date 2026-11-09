"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { approveAccessRequest, rejectAccessRequest, type ActionResult } from "@/app/admin/actions";
import type { AccessRequest } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";

export function AccessRequestsQueue({
  pending,
  processed,
}: {
  pending: AccessRequest[];
  processed: AccessRequest[];
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">
          Pendentes ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-brand-line bg-brand-bg px-4 py-6 text-center text-sm text-brand-ink-soft">
            Nenhuma solicitação pendente.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {pending.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </section>

      {processed.length > 0 ? (
        <section>
          <h2 className="font-heading text-base font-bold text-brand-ink-soft">
            Processadas ({processed.length})
          </h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-brand-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-semibold">Usuário</th>
                  <th className="px-4 py-2 font-semibold">Fornecedor</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {processed.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-brand-ink">{r.profile_name || "—"}</p>
                      <p className="text-xs text-brand-ink-soft">{r.profile_email}</p>
                    </td>
                    <td className="px-4 py-2.5 text-brand-ink">{r.supplier_name}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-brand-ink-soft">
                      {new Date(r.reviewed_at ?? r.requested_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RequestCard({ request }: { request: AccessRequest }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(false);

  async function handleApprove() {
    setActing(true);
    const r = await approveAccessRequest(request.id);
    setResult(r);
    setActing(false);
    if (r.ok) setDone(true);
  }

  async function handleReject() {
    setActing(true);
    const r = await rejectAccessRequest(request.id);
    setResult(r);
    setActing(false);
    if (r.ok) setDone(true);
  }

  const dateStr = new Date(request.requested_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (done) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green-soft/30 p-4 text-sm font-medium text-brand-green">
        {result?.ok}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-brand-ink">
            {request.profile_name || request.profile_email}
          </p>
          <p className="text-xs text-brand-ink-soft">{request.profile_email}</p>
          <p className="mt-1 text-xs text-brand-ink-soft">
            Quer acessar <strong className="text-brand-ink">{request.supplier_name}</strong> — {dateStr}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="brand"
            size="sm"
            onClick={handleApprove}
            disabled={acting}
            className="gap-1"
          >
            {acting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Aprovar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReject}
            disabled={acting}
            className="gap-1 text-brand-red hover:bg-brand-red/10"
          >
            <X className="size-3.5" /> Recusar
          </Button>
        </div>
      </div>

      {result?.error ? (
        <p className="mt-2 text-sm font-medium text-brand-red">{result.error}</p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: AccessRequest["status"] }) {
  const map = {
    pending: { label: "Pendente", cls: "bg-brand-yellow-soft text-brand-orange" },
    approved: { label: "Aprovado", cls: "bg-brand-green-soft text-brand-green" },
    rejected: { label: "Recusado", cls: "bg-brand-red/10 text-brand-red" },
  } as const;
  const { label, cls } = map[status];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase ${cls}`}>
      {label}
    </span>
  );
}
