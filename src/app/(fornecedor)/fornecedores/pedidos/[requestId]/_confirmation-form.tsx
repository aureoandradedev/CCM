"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Upload, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils/format";
import type { SupplierRequestLineRow, SupplierRequestMirror } from "@/lib/supplier/data";
import { submitSupplierConfirmation, uploadRequestMirror, type ConfirmationItem } from "../actions";

const STATUS_OPTIONS = [
  { value: "confirmado", label: "Disponível (qtd integral)" },
  { value: "confirmado_parcial", label: "Parcial (qtd menor)" },
  { value: "indisponivel", label: "Indisponível" },
  { value: "divergencia_quantidade", label: "Divergência de quantidade" },
  { value: "divergencia_custo", label: "Divergência de custo" },
] as const;

type ItemStatus = (typeof STATUS_OPTIONS)[number]["value"];

interface ItemState {
  status: ItemStatus;
  qtyConfirmed: number;
  costConfirmedCentavos: number | null;
  notes: string;
}

const input = "h-10 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const select = "h-10 w-full rounded-lg border border-brand-line bg-card px-2 text-sm text-brand-ink outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ConfirmationForm({ requestId, lines, mirrors, isPending, isResolved }: {
  requestId: string;
  lines: SupplierRequestLineRow[];
  mirrors: SupplierRequestMirror[];
  isPending: boolean;
  isResolved: boolean;
}) {
  const [states, setStates] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    for (const line of lines) {
      init[line.id] = {
        status: (line.status as ItemStatus) ?? "confirmado",
        qtyConfirmed: line.quantity_confirmed ?? line.quantity_requested,
        costConfirmedCentavos: line.cost_confirmed_centavos ?? line.unit_cost_centavos,
        notes: line.notes ?? "",
      };
    }
    return init;
  });

  const [submitting, startSubmit] = useTransition();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const updateItem = (id: string, patch: Partial<ItemState>) => {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleStatusChange = (id: string, status: ItemStatus, originalQty: number) => {
    const patch: Partial<ItemState> = { status };
    if (status === "confirmado") patch.qtyConfirmed = originalQty;
    if (status === "indisponivel") patch.qtyConfirmed = 0;
    updateItem(id, patch);
  };

  const handleSubmit = () => {
    const confirmations: ConfirmationItem[] = lines.map((line) => {
      const s = states[line.id];
      return {
        lineId: line.id,
        qtyConfirmed: s.qtyConfirmed,
        status: s.status,
        costConfirmedCentavos: s.status === "divergencia_custo" ? s.costConfirmedCentavos : null,
        notes: s.notes || undefined,
      };
    });

    startSubmit(async () => {
      const r = await submitSupplierConfirmation(requestId, confirmations);
      if (r.error) toast.error(r.error);
      else toast.success(r.ok);
    });
  };

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startUpload(async () => {
      const r = await uploadRequestMirror(requestId, fd);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-lg font-bold text-brand-navy">Itens do pedido</h2>
        <div className="mt-3 space-y-4">
          {lines.map((line) => {
            const s = states[line.id];
            const showQty = s.status === "confirmado_parcial" || s.status === "divergencia_quantidade";
            const showCost = s.status === "divergencia_custo";
            return (
              <div key={line.id} className="rounded-2xl border border-brand-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading font-bold text-brand-navy">{line.product_name}</p>
                    <p className="mt-0.5 text-xs text-brand-ink-soft">
                      {line.quantity_requested} {line.unit ?? "un"} · {formatBRL(line.unit_cost_centavos / 100)}/{line.unit ?? "un"} · Subtotal {formatBRL((line.quantity_requested * line.unit_cost_centavos) / 100)}
                    </p>
                  </div>
                </div>

                {isPending ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-brand-ink-soft">Status</label>
                      <select
                        className={select}
                        value={s.status}
                        onChange={(e) => handleStatusChange(line.id, e.target.value as ItemStatus, line.quantity_requested)}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {showQty ? (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-brand-ink-soft">Qtd confirmada</label>
                        <input
                          type="number"
                          className={input}
                          min={0}
                          max={line.quantity_requested}
                          value={s.qtyConfirmed}
                          onChange={(e) => updateItem(line.id, { qtyConfirmed: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </div>
                    ) : null}

                    {showCost ? (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-brand-ink-soft">Custo confirmado (R$)</label>
                        <input
                          type="number"
                          className={input}
                          min={0}
                          step={0.01}
                          value={s.costConfirmedCentavos != null ? (s.costConfirmedCentavos / 100).toFixed(2) : ""}
                          onChange={(e) => updateItem(line.id, { costConfirmedCentavos: Math.round(Number(e.target.value || 0) * 100) })}
                        />
                      </div>
                    ) : null}

                    <div className={showQty || showCost ? "" : "sm:col-span-1 lg:col-span-3"}>
                      <label className="mb-1 block text-xs font-medium text-brand-ink-soft">Observação</label>
                      <input
                        className={input}
                        placeholder="Opcional"
                        value={s.notes}
                        onChange={(e) => updateItem(line.id, { notes: e.target.value })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {line.status ? (
                      <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium">{line.status}</span>
                    ) : null}
                    {line.quantity_confirmed != null ? (
                      <span className="text-brand-ink-soft">Confirmado: {line.quantity_confirmed} {line.unit ?? "un"}</span>
                    ) : null}
                    {line.notes ? (
                      <span className="text-brand-ink-soft italic">{line.notes}</span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-heading text-lg font-bold text-brand-navy">Espelho / Documento</h2>
        <p className="mt-1 text-sm text-brand-ink-soft">Anexe o espelho ou documento de confirmação (PDF, JPEG, PNG, WebP — máx. 10 MB).</p>

        {mirrors.length > 0 ? (
          <div className="mt-3 space-y-2">
            {mirrors.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg border border-brand-line bg-muted/50 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-brand-ink-soft" />
                <span className="truncate">{m.file_path.split("/").pop()}</span>
                <span className="ml-auto text-xs text-brand-ink-soft">{m.file_type.toUpperCase()}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleUpload} />
          <Button variant="outline-navy" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {uploading ? "Enviando..." : "Anexar espelho"}
          </Button>
        </div>
      </section>

      {isPending ? (
        <div className="flex items-center gap-3 border-t border-brand-line pt-6">
          <Button variant="brand" size="lg" disabled={submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {submitting ? "Enviando..." : "Confirmar disponibilidade"}
          </Button>
          <p className="text-xs text-brand-ink-soft">Ao confirmar, os dados serão enviados à equipe de Compras para processamento.</p>
        </div>
      ) : null}
    </div>
  );
}
