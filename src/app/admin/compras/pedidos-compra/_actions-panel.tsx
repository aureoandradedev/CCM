"use client";

import { useActionState } from "react";

import { decidePurchaseOrder, type ActionResult } from "@/app/admin/actions";
import { Feedback } from "@/components/admin/ui";

const DECISIONS = [
  { value: "send", label: "Enviar", cls: "bg-brand-navy text-white hover:bg-brand-navy/90" },
  { value: "complete_order", label: "Completar pedido", cls: "bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30" },
  { value: "pay_difference", label: "Pagar diferença", cls: "bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30" },
  { value: "wait_next_cycle", label: "Esperar", cls: "border border-brand-line text-brand-ink hover:bg-brand-line/50" },
] as const;

export function PurchaseOrderActions({ poId, status, minimumMet }: { poId: string; status: string; minimumMet: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(decidePurchaseOrder, {});

  if (status !== "draft") return null;

  const options = minimumMet
    ? DECISIONS.filter((d) => d.value === "send")
    : DECISIONS;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((d) => (
        <form key={d.value} action={action}>
          <input type="hidden" name="purchase_order_id" value={poId} />
          <input type="hidden" name="decision" value={d.value} />
          <button type="submit" disabled={pending} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${d.cls}`}>
            {d.label}
          </button>
        </form>
      ))}
      <Feedback state={state} />
    </div>
  );
}
