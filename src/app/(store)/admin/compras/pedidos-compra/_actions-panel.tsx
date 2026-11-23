"use client";

import { useActionState } from "react";

import { decidePurchaseOrder, confirmPurchaseOrder, type ActionResult } from "@/app/admin/actions";
import { Feedback } from "@/components/admin/ui";
import type { MinOrderOption } from "@/lib/minimum-order";

function formatCentavos(c: number): string {
  return `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

const DECISION_MAP: Record<string, { decision: string; label: string }> = {
  wait_next_cycle: { decision: "wait_next_cycle", label: "Esperar próximo ciclo" },
  move_supplier: { decision: "move_supplier", label: "Mover fornecedor" },
  pay_fee: { decision: "pay_fee", label: "Pagar taxa" },
  complete_extra: { decision: "complete_order", label: "Completar com extras" },
};

function MinOrderOptionCard({
  option,
  poId,
  action,
  pending,
}: {
  option: MinOrderOption;
  poId: string;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  const mapping = DECISION_MAP[option.type];
  if (!mapping) return null;

  return (
    <div
      className={`rounded-lg border p-3 ${
        option.available ? "border-brand-line bg-card" : "border-dashed border-brand-line/60 bg-brand-bg/50 opacity-60"
      }`}
    >
      <p className="text-sm font-bold text-brand-ink">{option.label}</p>

      <div className="mt-1.5 space-y-0.5 text-xs text-brand-ink-soft">
        {option.extraCostCentavos > 0 && <p>Custo extra: {formatCentavos(option.extraCostCentavos)}</p>}
        {option.newDate && <p>Disponibilidade: {option.newDate}</p>}
        {option.affectedOrderCount > 0 && (
          <p>
            {option.affectedOrderCount} pedido(s) afetado(s)
          </p>
        )}
        {option.type === "move_supplier" && option.details?.targetSupplierName != null && (
          <p>Para: {String(option.details.targetSupplierName)}</p>
        )}
        {option.type === "complete_extra" && Array.isArray(option.details?.suggestedItems) && (
          <p>{(option.details.suggestedItems as unknown[]).length} item(ns) sugerido(s)</p>
        )}
      </div>

      {!option.available && option.reason && (
        <p className="mt-1.5 text-xs italic text-brand-ink-soft">{option.reason}</p>
      )}

      {option.available && (
        <form action={action} className="mt-2">
          <input type="hidden" name="purchase_order_id" value={poId} />
          <input type="hidden" name="decision" value={mapping.decision} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white transition hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {mapping.label}
          </button>
        </form>
      )}
    </div>
  );
}

export function PurchaseOrderActions({
  poId,
  status,
  minimumMet,
  minOrderOptions,
}: {
  poId: string;
  status: string;
  minimumMet: boolean;
  minOrderOptions?: MinOrderOption[];
}) {
  const [decisionState, decisionAction, decisionPending] = useActionState<ActionResult, FormData>(decidePurchaseOrder, {});
  const [confirmState, confirmAction, confirmPending] = useActionState<ActionResult, FormData>(confirmPurchaseOrder, {});

  if (status === "sent") {
    return (
      <form action={confirmAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="purchase_order_id" value={poId} />
        <button
          type="submit"
          disabled={confirmPending}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
        >
          Confirmar recebimento do fornecedor
        </button>
        <Feedback state={confirmState} />
      </form>
    );
  }

  if (!["draft", "ready", "minimum_not_met"].includes(status)) return null;

  if (minimumMet) {
    return (
      <div className="flex flex-wrap gap-2">
        <form action={decisionAction}>
          <input type="hidden" name="purchase_order_id" value={poId} />
          <input type="hidden" name="decision" value="send" />
          <button
            type="submit"
            disabled={decisionPending}
            className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-navy/90 disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
        <Feedback state={decisionState} />
      </div>
    );
  }

  if (minOrderOptions && minOrderOptions.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-brand-orange">Mínimo não atingido — escolha uma opção:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {minOrderOptions.map((opt) => (
            <MinOrderOptionCard
              key={opt.type}
              option={opt}
              poId={poId}
              action={decisionAction}
              pending={decisionPending}
            />
          ))}
        </div>
        <Feedback state={decisionState} />
      </div>
    );
  }

  // Fallback: flat buttons when no options computed
  const DECISIONS = [
    { value: "send", label: "Enviar mesmo assim", cls: "bg-brand-navy text-white hover:bg-brand-navy/90" },
    { value: "wait_next_cycle", label: "Esperar próximo ciclo", cls: "border border-brand-line text-brand-ink hover:bg-brand-line/50" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {DECISIONS.map((d) => (
        <form key={d.value} action={decisionAction}>
          <input type="hidden" name="purchase_order_id" value={poId} />
          <input type="hidden" name="decision" value={d.value} />
          <button type="submit" disabled={decisionPending} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${d.cls}`}>
            {d.label}
          </button>
        </form>
      ))}
      <Feedback state={decisionState} />
    </div>
  );
}
