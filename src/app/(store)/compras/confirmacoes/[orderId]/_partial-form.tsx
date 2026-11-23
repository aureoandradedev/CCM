"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { confirmOrderPartial, type ItemDecision } from "@/app/compras/actions";
import { Button } from "@/components/ui/button";
import type { OrderItemRow } from "@/lib/orders";
import { cn } from "@/lib/utils";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

interface ItemState {
  id: string;
  name: string;
  image: string | null;
  unit: string;
  originalQty: number;
  confirmedQty: number;
  unitPriceCentavos: number;
  retailPriceCentavos: number;
  removalReason: string;
  removed: boolean;
}

export function PartialConfirmationForm({
  orderId,
  items,
}: {
  orderId: string;
  items: OrderItemRow[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [showRejectAll, setShowRejectAll] = useState(false);
  const [rejectAllMotivo, setRejectAllMotivo] = useState("");

  const [itemStates, setItemStates] = useState<ItemState[]>(
    items.map((it) => ({
      id: it.id,
      name: it.name,
      image: it.image,
      unit: it.unit,
      originalQty: it.qty,
      confirmedQty: it.qty,
      unitPriceCentavos: it.unit_price_centavos,
      retailPriceCentavos: it.retail_price_centavos,
      removalReason: "",
      removed: false,
    })),
  );

  const updateItem = useCallback((id: string, patch: Partial<ItemState>) => {
    setItemStates((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const summary = useMemo(() => {
    let subtotal = 0;
    let confirmedCount = 0;
    let removedCount = 0;
    let reducedCount = 0;
    for (const it of itemStates) {
      if (it.removed || it.confirmedQty === 0) {
        removedCount++;
      } else {
        subtotal += it.confirmedQty * it.unitPriceCentavos;
        confirmedCount++;
        if (it.confirmedQty < it.originalQty) reducedCount++;
      }
    }
    return { subtotal, confirmedCount, removedCount, reducedCount, allRemoved: confirmedCount === 0 };
  }, [itemStates]);

  const hasChanges = useMemo(
    () => itemStates.some((it) => it.removed || it.confirmedQty !== it.originalQty),
    [itemStates],
  );

  async function handleConfirm() {
    if (summary.allRemoved) {
      toast.error("Todos os itens foram removidos. Use \"Rejeitar pedido\" para cancelar.");
      return;
    }

    const needsReason = itemStates.filter(
      (it) => (it.removed || it.confirmedQty < it.originalQty) && !it.removalReason.trim(),
    );
    if (needsReason.length > 0) {
      toast.error(`Informe o motivo para: ${needsReason.map((it) => it.name).join(", ")}`);
      return;
    }

    setPending(true);
    const decisions: ItemDecision[] = itemStates.map((it) => ({
      item_id: it.id,
      qty_confirmed: it.removed ? 0 : it.confirmedQty,
      removal_reason: (it.removed || it.confirmedQty < it.originalQty) ? it.removalReason.trim() || undefined : undefined,
    }));

    const r = await confirmOrderPartial(orderId, decisions);
    setPending(false);
    if (r.error) {
      toast.error(r.error);
    } else {
      toast.success(r.ok);
      router.push("/compras/confirmacoes");
    }
  }

  async function handleRejectAll() {
    if (rejectAllMotivo.trim().length < 3) {
      toast.error("Informe o motivo da rejeição.");
      return;
    }
    setPending(true);
    const decisions: ItemDecision[] = itemStates.map((it) => ({
      item_id: it.id,
      qty_confirmed: 0,
      removal_reason: rejectAllMotivo.trim(),
    }));
    const r = await confirmOrderPartial(orderId, decisions);
    setPending(false);
    if (r.error) {
      toast.error(r.error);
    } else {
      toast.success(r.ok || "Pedido rejeitado e cancelado.");
      router.push("/compras/confirmacoes");
    }
  }

  return (
    <div className="space-y-3">
      {itemStates.map((it) => (
        <ItemCard key={it.id} item={it} onUpdate={updateItem} disabled={pending} />
      ))}

      {/* Summary bar */}
      <div className="sticky bottom-0 z-10 rounded-xl border border-brand-line bg-card p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 text-sm">
            <p className="font-heading font-bold text-brand-navy">
              {summary.confirmedCount} item(ns) confirmado(s)
              {summary.reducedCount > 0 && <span className="text-brand-orange"> · {summary.reducedCount} com quantidade reduzida</span>}
              {summary.removedCount > 0 && <span className="text-brand-red"> · {summary.removedCount} removido(s)</span>}
            </p>
            <p className="text-brand-ink-soft">
              Novo subtotal: <strong className="text-brand-ink">{formatBRL(summary.subtotal)}</strong>
              {hasChanges && <span className="ml-2 text-xs text-brand-orange">(alterado)</span>}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRejectAll(!showRejectAll)}
              disabled={pending}
            >
              <Trash2 className="size-4" /> Rejeitar pedido
            </Button>
            <Button
              variant="navy"
              size="sm"
              onClick={handleConfirm}
              disabled={pending || summary.allRemoved}
            >
              <CheckCircle className="size-4" />
              {hasChanges ? "Confirmar parcialmente" : "Confirmar tudo"}
            </Button>
          </div>
        </div>

        {showRejectAll && (
          <div className="mt-3 flex items-end gap-2 border-t border-brand-line pt-3">
            <label className="flex-1">
              <span className="text-xs font-semibold text-brand-ink">Motivo da rejeição total</span>
              <input
                type="text"
                value={rejectAllMotivo}
                onChange={(e) => setRejectAllMotivo(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
                placeholder="Ex: fornecedor sem estoque"
                required
                minLength={3}
              />
            </label>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRejectAll}
              disabled={pending || rejectAllMotivo.trim().length < 3}
            >
              Confirmar rejeição total
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onUpdate,
  disabled,
}: {
  item: ItemState;
  onUpdate: (id: string, patch: Partial<ItemState>) => void;
  disabled: boolean;
}) {
  const isReduced = !item.removed && item.confirmedQty < item.originalQty;
  const lineTotal = item.removed ? 0 : item.confirmedQty * item.unitPriceCentavos;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        item.removed
          ? "border-brand-red/30 bg-brand-red/5 opacity-70"
          : isReduced
            ? "border-brand-orange/30"
            : "border-brand-line",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        {/* Product image */}
        {item.image && (
          <img
            src={item.image}
            alt={item.name}
            className="size-14 shrink-0 rounded-lg border border-brand-line object-cover"
          />
        )}

        {/* Product info */}
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-bold text-brand-navy">{item.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
            <span>Unidade: {item.unit}</span>
            <span>Preço unit.: {formatBRL(item.unitPriceCentavos)}</span>
            <span>Qtd original: <strong>{item.originalQty}</strong></span>
            <span>Total: <strong className="text-brand-ink">{formatBRL(lineTotal)}</strong></span>
          </div>
        </div>

        {/* Qty controls */}
        <div className="flex shrink-0 items-center gap-1">
          {item.removed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUpdate(item.id, { removed: false, confirmedQty: item.originalQty, removalReason: "" })}
              disabled={disabled}
            >
              <Undo2 className="size-4" /> Restaurar
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onUpdate(item.id, { confirmedQty: Math.max(1, item.confirmedQty - 1) })}
                disabled={disabled || item.confirmedQty <= 1}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className={cn(
                "w-10 text-center font-heading text-sm font-bold",
                isReduced ? "text-brand-orange" : "text-brand-ink",
              )}>
                {item.confirmedQty}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => onUpdate(item.id, { confirmedQty: Math.min(item.originalQty, item.confirmedQty + 1) })}
                disabled={disabled || item.confirmedQty >= item.originalQty}
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-1 text-brand-red hover:bg-brand-red/10"
                onClick={() => onUpdate(item.id, { removed: true, confirmedQty: 0 })}
                disabled={disabled}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Reduction/removal reason */}
      {(item.removed || isReduced) && (
        <div className="mt-3 border-t border-brand-line pt-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-orange" />
            <label className="flex-1">
              <span className="text-xs font-semibold text-brand-ink">
                {item.removed ? "Motivo da remoção" : `Motivo da redução (${item.originalQty} → ${item.confirmedQty})`}
              </span>
              <input
                type="text"
                value={item.removalReason}
                onChange={(e) => onUpdate(item.id, { removalReason: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
                placeholder="Ex: indisponível no fornecedor"
                required
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
