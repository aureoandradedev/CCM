"use client";

import { FileText, RefreshCw, AlertTriangle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { syncFiscalDoc, retryFiscalDoc, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/orders";
import type { FiscalDocumentRow, FiscalStatus } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<FiscalStatus, string> = {
  pending: "Pendente",
  sending: "Enviando",
  created: "DAV criado",
  invoiced: "Faturado",
  cancelled: "Cancelado",
  error: "Erro",
};

const STATUS_COLOR: Record<FiscalStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  sending: "bg-blue-100 text-blue-800",
  created: "bg-green-100 text-green-800",
  invoiced: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-500",
  error: "bg-red-100 text-red-800",
};

function FiscalBadge({ status }: { status: FiscalStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function FiscalStatusPanel({ docs }: { docs: FiscalDocumentRow[] }) {
  const [pending, start] = useTransition();

  if (!docs.length) {
    return (
      <div className="rounded-lg border border-brand-line bg-brand-surface p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-ink">
          <FileText className="h-4 w-4" /> Fiscal
        </h3>
        <p className="text-sm text-brand-ink-soft">Nenhum documento fiscal emitido.</p>
      </div>
    );
  }

  function handleSync(docId: string) {
    start(async () => {
      const r: ActionResult = await syncFiscalDoc(docId);
      if (r.ok) toast.success("Status fiscal sincronizado");
      else toast.error(r.error || "Erro ao sincronizar");
    });
  }

  function handleRetry(docId: string) {
    start(async () => {
      const r: ActionResult = await retryFiscalDoc(docId);
      if (r.ok) toast.success("Reenvio solicitado");
      else toast.error(r.error || "Erro ao reenviar");
    });
  }

  return (
    <div className="rounded-lg border border-brand-line bg-brand-surface p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
        <FileText className="h-4 w-4" /> Fiscal
      </h3>
      <div className="space-y-3">
        {docs.map((doc) => (
          <div key={doc.id} className="rounded border border-brand-line bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FiscalBadge status={doc.status} />
                {doc.provider_reference && (
                  <span className="font-mono text-xs text-brand-ink-soft">DAV #{doc.provider_reference}</span>
                )}
              </div>
              <div className="flex gap-1">
                {doc.status === "created" && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => handleSync(doc.id)}>
                    <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} /> Sincronizar
                  </Button>
                )}
                {doc.status === "error" && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRetry(doc.id)}>
                    <RefreshCw className="h-3 w-3" /> Reenviar
                  </Button>
                )}
              </div>
            </div>

            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <Dt k="Código e-commerce" v={doc.codigo_ecommerce} />
              <Dt k="Criado" v={formatDateTime(doc.created_at)} />
              {doc.sent_at && <Dt k="Enviado" v={formatDateTime(doc.sent_at)} />}
              {doc.invoiced_at && <Dt k="Faturado" v={formatDateTime(doc.invoiced_at)} />}
              {doc.cancelled_at && <Dt k="Cancelado" v={formatDateTime(doc.cancelled_at)} />}
              <Dt k="Tentativas" v={String(doc.attempt_count)} />
              {doc.shipment_id && <Dt k="Entrega" v={doc.shipment_id.slice(0, 8)} />}
            </dl>

            {doc.last_error && (
              <div className="mt-2 flex items-start gap-1 rounded bg-red-50 p-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="break-all">{doc.last_error}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-brand-ink-soft">{k}</dt>
      <dd className="font-medium text-brand-ink">{v}</dd>
    </div>
  );
}
