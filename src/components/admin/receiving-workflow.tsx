"use client";

import { useState } from "react";
import { CheckCircle, Loader2, Package, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface ReceivingItem {
  purchaseOrderItemId: string;
  masterProductId: string;
  productName: string;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  damagedQty: number;
  notes: string;
}

interface AllocationEntry {
  shipmentId: string;
  orderId: string;
  masterProductId: string;
  allocatedQty: number;
}

type Phase = "loading" | "inspecting" | "summary" | "allocation" | "done" | "error";

export function ReceivingWorkflow({ poId }: { poId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expectedItems, setExpectedItems] = useState<{ id: string; master_product_id: string; product_name: string; quantity_units: number }[]>([]);
  const [inspected, setInspected] = useState<Map<string, ReceivingItem>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [allocationPlan, setAllocationPlan] = useState<{ allocations: AllocationEntry[]; fullyAllocatedShipments: string[]; partiallyAllocatedShipments: string[] } | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

  async function apiFetch(path: string, body: unknown) {
    const res = await fetch(`${apiBase}/api/recebimento${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.erro || "Erro na API");
    return json;
  }

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch("/start", { purchaseOrderId: poId });
      setSessionId(json.session.id);
      setExpectedItems(json.expectedItems || []);
      setPhase("inspecting");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  function updateItem(poiId: string, field: keyof ReceivingItem, value: string | number) {
    setInspected((prev) => {
      const next = new Map(prev);
      const item = next.get(poiId) || {
        purchaseOrderItemId: poiId,
        masterProductId: expectedItems.find((e) => e.id === poiId)?.master_product_id || "",
        productName: expectedItems.find((e) => e.id === poiId)?.product_name || "",
        expectedQty: expectedItems.find((e) => e.id === poiId)?.quantity_units || 0,
        receivedQty: 0,
        acceptedQty: 0,
        damagedQty: 0,
        notes: "",
      };
      next.set(poiId, { ...item, [field]: value });
      return next;
    });
  }

  async function handleRecordItem(poiId: string) {
    const item = inspected.get(poiId);
    if (!item || !sessionId) return;
    setBusy(true);
    try {
      await apiFetch("/item", { sessionId, ...item });
      if (currentIdx < expectedItems.length - 1) {
        setCurrentIdx((i) => i + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch("/complete", { sessionId });
      setSummary(json.summary);
      setAllocationPlan(json.allocationInputs ? { allocations: [], fullyAllocatedShipments: [], partiallyAllocatedShipments: [] } : null);
      setPhase("summary");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAllocation() {
    if (!sessionId || !allocationPlan) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/confirm-allocation", { sessionId, allocations: allocationPlan.allocations });
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Package className="h-10 w-10 text-brand-navy" />
        <p className="text-sm text-brand-ink-soft">Iniciar conferência de recebimento para este pedido de compra.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleStart} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Iniciar conferência"}
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <p className="text-sm text-red-600">{error}</p>
        <Button onClick={() => setPhase("loading")}>Tentar novamente</Button>
      </div>
    );
  }

  if (phase === "inspecting") {
    const current = expectedItems[currentIdx];
    if (!current) return null;
    const item = inspected.get(current.id);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Item {currentIdx + 1} de {expectedItems.length}</h3>
          <span className="text-xs text-brand-ink-soft">{inspected.size} conferidos</span>
        </div>

        <div className="rounded border border-border p-4 space-y-3">
          <p className="font-medium">{current.product_name}</p>
          <p className="text-sm text-brand-ink-soft">Esperado: {current.quantity_units} un.</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs text-brand-ink-soft">Recebido</span>
              <input
                type="number"
                min={0}
                className={cn(inputCls, "text-center")}
                value={item?.receivedQty ?? ""}
                onChange={(e) => updateItem(current.id, "receivedQty", parseInt(e.target.value) || 0)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-ink-soft">Aceito</span>
              <input
                type="number"
                min={0}
                className={cn(inputCls, "text-center")}
                value={item?.acceptedQty ?? ""}
                onChange={(e) => updateItem(current.id, "acceptedQty", parseInt(e.target.value) || 0)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-ink-soft">Avariado</span>
              <input
                type="number"
                min={0}
                className={cn(inputCls, "text-center")}
                value={item?.damagedQty ?? ""}
                onChange={(e) => updateItem(current.id, "damagedQty", parseInt(e.target.value) || 0)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-ink-soft">Notas</span>
              <input
                type="text"
                className={inputCls}
                value={item?.notes ?? ""}
                onChange={(e) => updateItem(current.id, "notes", e.target.value)}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !item?.receivedQty} onClick={() => handleRecordItem(current.id)}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Registrar item"}
            </Button>
            {currentIdx > 0 && (
              <Button size="sm" variant="outline" onClick={() => setCurrentIdx((i) => i - 1)}>Anterior</Button>
            )}
            {currentIdx < expectedItems.length - 1 && (
              <Button size="sm" variant="outline" onClick={() => setCurrentIdx((i) => i + 1)}>Próximo</Button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {inspected.size === expectedItems.length && (
          <Button onClick={handleComplete} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Finalizar conferência"}
          </Button>
        )}
      </div>
    );
  }

  if (phase === "summary") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-brand-green" />
          <h3 className="font-semibold">Conferência concluída</h3>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-border p-3 text-center">
              <p className="text-2xl font-bold">{(summary as Record<string, number>).totalExpected}</p>
              <p className="text-xs text-brand-ink-soft">Esperado</p>
            </div>
            <div className="rounded border border-border p-3 text-center">
              <p className="text-2xl font-bold">{(summary as Record<string, number>).totalReceived}</p>
              <p className="text-xs text-brand-ink-soft">Recebido</p>
            </div>
            <div className="rounded border border-border p-3 text-center">
              <p className="text-2xl font-bold">{(summary as Record<string, number>).totalAccepted}</p>
              <p className="text-xs text-brand-ink-soft">Aceito</p>
            </div>
            <div className="rounded border border-border p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{(summary as Record<string, number>).totalDamaged}</p>
              <p className="text-xs text-brand-ink-soft">Avariado</p>
            </div>
          </div>
        )}

        <Button onClick={handleConfirmAllocation} disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar alocação e entrada no estoque"}
        </Button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle className="h-10 w-10 text-brand-green" />
        <p className="font-medium">Recebimento confirmado e estoque atualizado.</p>
        <p className="text-sm text-brand-ink-soft">Exceções foram registradas automaticamente para faltas e avarias.</p>
      </div>
    );
  }

  return null;
}
