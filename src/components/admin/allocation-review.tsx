"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, Package, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface ReceivingItem {
  id: string;
  master_product_id: string;
  expected_qty: number;
  received_qty: number;
  accepted_qty: number;
  damaged_qty: number;
  master_products?: { name: string };
}

interface AllocationEntry {
  orderItemId: string;
  shipmentId: string;
  orderId: string;
  masterProductId: string;
  allocatedQty: number;
}

interface PendingItem {
  orderItemId: string;
  shipmentId: string;
  orderId: string;
  masterProductId: string;
  quantity: number;
  promisedTo: string | null;
  createdAt: string | null;
}

interface AllocationPlan {
  received: { masterProductId: string; acceptedQty: number }[];
  pending: PendingItem[];
  summary: { totalExpected: number; totalReceived: number; totalAccepted: number; totalDamaged: number };
}

type Phase = "loading" | "review" | "confirming" | "done" | "error";

export function AllocationReview({
  sessionId,
  receivingItems,
}: {
  sessionId: string;
  receivingItems: ReceivingItem[];
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function loadPlan() {
      try {
        const json = await apiFetch<AllocationPlan & { ok: boolean }>("/recebimento/allocation-plan", { body: { sessionId } });
        setPlan({
          received: json.received,
          pending: json.pending,
          summary: json.summary,
        });

        const computed = computeAllocations(json.received, json.pending);
        setAllocations(computed);
        setPhase("review");
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    }
    loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function computeAllocations(
    received: { masterProductId: string; acceptedQty: number }[],
    pending: PendingItem[],
  ): AllocationEntry[] {
    const stock = new Map<string, number>();
    for (const r of received) {
      stock.set(r.masterProductId, (stock.get(r.masterProductId) ?? 0) + r.acceptedQty);
    }

    const grouped = new Map<string, { shipmentId: string; orderId: string; promisedTo: string | null; createdAt: string | null; items: { orderItemId: string; masterProductId: string; quantity: number }[] }>();
    for (const p of pending) {
      let g = grouped.get(p.shipmentId);
      if (!g) {
        g = { shipmentId: p.shipmentId, orderId: p.orderId, promisedTo: p.promisedTo, createdAt: p.createdAt, items: [] };
        grouped.set(p.shipmentId, g);
      }
      g.items.push({ orderItemId: p.orderItemId, masterProductId: p.masterProductId, quantity: p.quantity });
    }

    const groups = Array.from(grouped.values()).sort((a, b) => {
      const ad = a.promisedTo ?? "9999-12-31";
      const bd = b.promisedTo ?? "9999-12-31";
      if (ad !== bd) return ad < bd ? -1 : 1;
      const ac = a.createdAt ?? "9999-12-31T23:59:59Z";
      const bc = b.createdAt ?? "9999-12-31T23:59:59Z";
      return ac < bc ? -1 : ac > bc ? 1 : 0;
    });

    const entries: AllocationEntry[] = [];

    for (const g of groups) {
      const canFull = g.items.every((i) => (stock.get(i.masterProductId) ?? 0) >= i.quantity);
      if (canFull) {
        for (const i of g.items) {
          stock.set(i.masterProductId, (stock.get(i.masterProductId) ?? 0) - i.quantity);
          entries.push({ orderItemId: i.orderItemId, shipmentId: g.shipmentId, orderId: g.orderId, masterProductId: i.masterProductId, allocatedQty: i.quantity });
        }
      }
    }

    for (const g of groups) {
      if (entries.some((e) => e.shipmentId === g.shipmentId)) continue;
      for (const i of g.items) {
        const avail = stock.get(i.masterProductId) ?? 0;
        if (avail <= 0) continue;
        const qty = Math.min(avail, i.quantity);
        stock.set(i.masterProductId, avail - qty);
        entries.push({ orderItemId: i.orderItemId, shipmentId: g.shipmentId, orderId: g.orderId, masterProductId: i.masterProductId, allocatedQty: qty });
      }
    }

    return entries;
  }

  async function handleConfirm() {
    setPhase("confirming");
    setError(null);
    try {
      await apiFetch("/recebimento/confirm-allocation", { body: { sessionId, allocations } });
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
        <p className="text-sm text-brand-ink-soft">Recalculando plano de alocação...</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <Button onClick={() => router.push("/admin/recebimento")}>Voltar ao recebimento</Button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle className="h-10 w-10 text-brand-green" />
        <p className="font-medium">Alocação confirmada e estoque atualizado.</p>
        <p className="text-sm text-brand-ink-soft">Exceções foram registradas automaticamente para faltas e avarias.</p>
        <Button onClick={() => router.push("/admin/recebimento")}>Voltar ao recebimento</Button>
      </div>
    );
  }

  const productNames = new Map<string, string>();
  for (const ri of receivingItems) {
    productNames.set(ri.master_product_id, ri.master_products?.name ?? ri.master_product_id.slice(0, 8));
  }

  const remainingStock = new Map<string, number>();
  if (plan) {
    for (const r of plan.received) {
      remainingStock.set(r.masterProductId, r.acceptedQty);
    }
    for (const a of allocations) {
      remainingStock.set(a.masterProductId, (remainingStock.get(a.masterProductId) ?? 0) - a.allocatedQty);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      {plan && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-border p-3 text-center">
            <p className="text-2xl font-bold">{plan.summary.totalExpected}</p>
            <p className="text-xs text-brand-ink-soft">Esperado</p>
          </div>
          <div className="rounded border border-border p-3 text-center">
            <p className="text-2xl font-bold">{plan.summary.totalReceived}</p>
            <p className="text-xs text-brand-ink-soft">Recebido</p>
          </div>
          <div className="rounded border border-border p-3 text-center">
            <p className="text-2xl font-bold">{plan.summary.totalAccepted}</p>
            <p className="text-xs text-brand-ink-soft">Aceito</p>
          </div>
          <div className="rounded border border-border p-3 text-center">
            <p className={cn("text-2xl font-bold", plan.summary.totalDamaged > 0 && "text-red-600")}>{plan.summary.totalDamaged}</p>
            <p className="text-xs text-brand-ink-soft">Avariado</p>
          </div>
        </div>
      )}

      {/* Receiving items */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Itens conferidos</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-brand-ink-soft">
                <th className="pb-2">Produto</th>
                <th className="pb-2 text-center">Esperado</th>
                <th className="pb-2 text-center">Recebido</th>
                <th className="pb-2 text-center">Aceito</th>
                <th className="pb-2 text-center">Avariado</th>
              </tr>
            </thead>
            <tbody>
              {receivingItems.map((ri) => (
                <tr key={ri.id} className="border-b border-border">
                  <td className="py-2">{ri.master_products?.name ?? ri.master_product_id.slice(0, 8)}</td>
                  <td className="py-2 text-center">{ri.expected_qty}</td>
                  <td className="py-2 text-center">{ri.received_qty}</td>
                  <td className="py-2 text-center">{ri.accepted_qty}</td>
                  <td className={cn("py-2 text-center", ri.damaged_qty > 0 && "text-red-600 font-medium")}>{ri.damaged_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocation plan */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Plano de alocação</h3>
        {allocations.length === 0 ? (
          <p className="text-sm text-brand-ink-soft">Nenhum pedido de cliente aguardando esses produtos. Estoque irá direto para o inventário.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-brand-ink-soft">
                  <th className="pb-2">Pedido</th>
                  <th className="pb-2">Remessa</th>
                  <th className="pb-2">Produto</th>
                  <th className="pb-2 text-center">Qtd alocada</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2 font-mono text-xs">{a.orderId.slice(0, 8)}...</td>
                    <td className="py-2 font-mono text-xs">{a.shipmentId.slice(0, 8)}...</td>
                    <td className="py-2">{productNames.get(a.masterProductId) ?? a.masterProductId.slice(0, 8)}</td>
                    <td className="py-2 text-center font-medium">{a.allocatedQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Remaining stock */}
      {Array.from(remainingStock.entries()).some(([, qty]) => qty > 0) && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Sobra para estoque</h3>
          <div className="flex flex-wrap gap-2">
            {Array.from(remainingStock.entries())
              .filter(([, qty]) => qty > 0)
              .map(([pid, qty]) => (
                <span key={pid} className="rounded-full bg-brand-green/10 px-3 py-1 text-xs font-medium text-brand-green">
                  {productNames.get(pid) ?? pid.slice(0, 8)}: +{qty} un.
                </span>
              ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Confirm button */}
      <Button
        onClick={handleConfirm}
        disabled={phase === "confirming"}
        className="w-full"
        size="lg"
      >
        {phase === "confirming" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Package className="mr-2 h-4 w-4" />
            Confirmar alocação e entrada no estoque
          </>
        )}
      </Button>
    </div>
  );
}
