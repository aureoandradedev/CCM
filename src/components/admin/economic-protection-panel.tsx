"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertTriangle, Lock, Truck, XCircle } from "lucide-react";

import { resolveResultProtection, type ActionResult } from "@/app/admin/actions";
import { Card, Feedback } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils/format";
import type { OrderResultLockRow, OrderFreightAllocationRow } from "@/lib/admin/types";

function brl(centavos: number) {
  return formatBRL(centavos / 100);
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  auto_approved: { text: "Auto-aprovado", color: "text-emerald-600" },
  approved: { text: "Aprovado", color: "text-emerald-600" },
  rejected: { text: "Rejeitado", color: "text-red-600" },
  pending: { text: "Pendente", color: "text-amber-600" },
};

export function EconomicProtectionPanel({
  orderId,
  resultLock,
  freightAllocations,
}: {
  orderId: string;
  resultLock: OrderResultLockRow | null;
  freightAllocations: OrderFreightAllocationRow[];
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(resolveResultProtection, {});

  if (!resultLock && freightAllocations.length === 0) return null;

  const isApproved = resultLock?.status === "approved" || resultLock?.status === "auto_approved";
  const isRejected = resultLock?.status === "rejected";
  const isPending = resultLock?.status === "pending";
  const statusInfo = resultLock ? STATUS_LABEL[resultLock.status] ?? { text: resultLock.status, color: "text-brand-ink-soft" } : null;

  return (
    <Card title="Proteção econômica">
      <div className="space-y-4">
        {resultLock ? (
          <>
            <div className="flex items-start gap-2">
              {isApproved ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : isRejected ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              )}
              <div>
                <p className="text-sm font-semibold text-brand-ink">
                  Resultado: {brl(resultLock.projected_result_centavos)}
                  {statusInfo && (
                    <span className={`ml-2 text-xs font-normal ${statusInfo.color}`}>{statusInfo.text}</span>
                  )}
                </p>
                <p className="text-xs text-brand-ink-soft">
                  Mínimo: {brl(resultLock.min_result_centavos)}
                </p>
              </div>
            </div>

            <dl className="grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Dt k="Receita" v={brl(resultLock.revenue_centavos)} />
              <Dt k="Custo fornecedor" v={`- ${brl(resultLock.supplier_cost_centavos)}`} />
              <Dt k="Frete fornecedor" v={`- ${brl(resultLock.supplier_freight_centavos)}`} />
              <Dt k="Desconto" v={`- ${brl(resultLock.discount_centavos)}`} />
              <Dt k="Desc. crédito" v={`- ${brl(resultLock.credit_discount_centavos)}`} />
            </dl>

            {isPending && (
              <form action={action} className="flex items-center gap-2">
                <input type="hidden" name="order_id" value={orderId} />
                <Feedback state={state} />
                <Button type="submit" name="decision" value="approved" variant="outline" size="sm" disabled={pending}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  {pending ? "Salvando..." : "Aprovar"}
                </Button>
                <Button type="submit" name="decision" value="rejected" variant="outline" size="sm" disabled={pending} className="text-red-600 hover:text-red-700">
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Rejeitar
                </Button>
              </form>
            )}

            {resultLock.decided_by && resultLock.decided_at && (
              <p className="text-xs text-brand-ink-soft">
                Decisão em {new Date(resultLock.decided_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </p>
            )}
          </>
        ) : null}

        {freightAllocations.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-brand-ink">
              <Truck className="h-4 w-4" /> Rateio de frete
            </p>
            <div className="divide-y divide-brand-line rounded-lg border border-brand-line text-xs">
              {freightAllocations.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-brand-ink-soft">
                    PO {a.purchase_order_id.slice(0, 8)}
                  </span>
                  <span className="font-mono tabular-nums text-brand-navy">{brl(a.freight_allocated_centavos)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-brand-ink-soft">{k}</dt>
      <dd className="font-mono tabular-nums">{v}</dd>
    </div>
  );
}
