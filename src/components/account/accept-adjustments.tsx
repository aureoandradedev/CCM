"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptOrderAdjustments } from "@/app/conta/actions";
import type { OrderItemRow } from "@/lib/orders";
import { formatBRL, formatUnit } from "@/lib/utils/format";

export function AcceptAdjustments({ orderId, items }: { orderId: string; items: OrderItemRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const adjustments = items.filter((i) => i.qty_confirmed != null && i.qty_confirmed !== i.qty);
  if (!adjustments.length) return null;

  const handleAccept = () => {
    startTransition(async () => {
      const r = await acceptOrderAdjustments(orderId);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-2xl border border-brand-orange/30 bg-brand-orange-soft p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-orange" />
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold text-brand-navy">Ajustes no seu pedido</p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            Alguns itens foram ajustados pelos fornecedores. Revise e aceite para liberar o pagamento.
          </p>
          <ul className="mt-3 space-y-1.5">
            {adjustments.map((it) => (
              <li key={it.id} className="text-sm">
                <span className="font-medium text-brand-ink">{it.name}</span>
                {" — "}
                {it.qty_confirmed === 0 ? (
                  <span className="text-brand-red">removido</span>
                ) : (
                  <span className="text-brand-ink-soft">
                    de {it.qty} para {it.qty_confirmed} {formatUnit(it.unit)}
                  </span>
                )}
                {it.removal_reason ? <span className="ml-1 text-xs text-brand-ink-soft">({it.removal_reason})</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button variant="brand" size="sm" disabled={pending} onClick={handleAccept}>
              {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {pending ? "Processando..." : "Aceitar ajustes e liberar pagamento"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
