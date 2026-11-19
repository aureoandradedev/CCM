"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CheckCircle, MapPin, Package, Plus, Truck } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import {
  startPreparation, finishForShipping, finishForPickup,
  logSeparadorOccurrence, markItemPicked,
} from "@/app/separador/actions";
import {
  SEPARADOR_OCCURRENCE_TYPES,
  type ActionResult, type SeparadorOccurrenceType,
} from "@/app/separador/constants";
import { Button } from "@/components/ui/button";
import { formatDate, shipmentStatusLabel, TONE_CLASS } from "@/lib/orders";
import { SHIPMENT_STATUS_LABEL, OCCURRENCE_LABELS } from "@/lib/shipment-lifecycle";
import type { SeparadorShipmentDetail } from "@/lib/separador/data";
import { cn } from "@/lib/utils";

const initial: ActionResult = {};

const SEPARADOR_OCCURRENCE_LABELS: Record<SeparadorOccurrenceType, string> = {
  damage: OCCURRENCE_LABELS.damage,
  note: OCCURRENCE_LABELS.note,
};

function useAction(action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>) {
  const [state, formAction, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, initial);
  return { state, formAction, pending };
}

function ItemPickRow({ item, shipmentId, isPreparing }: {
  item: SeparadorShipmentDetail["items"][number];
  shipmentId: string;
  isPreparing: boolean;
}) {
  const pickAction = useAction(markItemPicked);
  const isPicked = item.picked_qty !== null && item.picked_qty >= item.qty;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {isPreparing && (
        <form action={pickAction.formAction} className="shrink-0">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="pickedQty" value={isPicked ? "0" : String(item.qty)} />
          <button
            type="submit"
            disabled={pickAction.pending}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg border-2 transition-colors",
              isPicked
                ? "border-brand-green bg-brand-green text-white"
                : "border-brand-line bg-card text-transparent hover:border-brand-blue/40",
            )}
            aria-label={isPicked ? `${item.name} conferido` : `Conferir ${item.name}`}
          >
            <Check className="size-4" strokeWidth={3} />
          </button>
        </form>
      )}

      {item.image ? (
        <Image src={item.image} alt="" width={48} height={48} className="size-12 shrink-0 rounded-lg border border-brand-line object-cover" />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-muted">
          <Package className="size-5 text-brand-ink-soft/40" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", isPicked ? "text-brand-green" : "text-brand-ink")}>{item.name}</p>
        {item.sku && <p className="text-[0.65rem] text-brand-ink-soft">SKU: {item.sku}</p>}
        {isPreparing && item.picked_qty !== null && item.picked_qty > 0 && (
          <p className="text-[0.65rem] font-medium text-brand-green">
            Separado: {item.picked_qty}/{item.qty}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-heading text-sm font-bold text-brand-navy">{item.qty}</p>
        <p className="text-[0.65rem] text-brand-ink-soft">{item.unit}</p>
      </div>
    </li>
  );
}

export function SeparadorWorkflow({ detail }: { detail: SeparadorShipmentDetail }) {
  const [showConfirm, setShowConfirm] = useState<"envio" | "retirada" | null>(null);
  const [showOccurrence, setShowOccurrence] = useState(false);
  const [occType, setOccType] = useState<SeparadorOccurrenceType>("note");
  const [occDesc, setOccDesc] = useState("");

  const startAction = useAction(startPreparation);
  const finishShipAction = useAction(finishForShipping);
  const finishPickupAction = useAction(finishForPickup);
  const occAction = useAction(logSeparadorOccurrence);

  const { status, delivery_method } = detail;
  const isPickup = delivery_method === "pickup";
  const statusInfo = shipmentStatusLabel(status);
  const isTerminal = status === "entregue" || status === "cancelado";
  const isFinished = status === "pronto_para_envio" || status === "pronto_para_retirada";
  const isPreparing = status === "preparando";

  const pickedCount = detail.items.filter((i) => i.picked_qty !== null && i.picked_qty >= i.qty).length;
  const allPicked = pickedCount === detail.items.length && detail.items.length > 0;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link href="/separador" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">
        <ArrowLeft className="size-3.5" /> Voltar à fila
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-brand-line bg-card p-4">
        <div className="flex items-center gap-2">
          {isPickup ? <MapPin className="size-5 text-brand-navy" /> : <Truck className="size-5 text-brand-navy" />}
          <h1 className="font-heading text-base font-bold text-brand-navy">
            {detail.order_code} · Entrega {detail.sequence}
          </h1>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-semibold", TONE_CLASS[statusInfo.tone])}>
            {SHIPMENT_STATUS_LABEL[status] ?? statusInfo.label}
          </span>
          <span className="text-xs text-brand-ink-soft">
            {isPickup ? "Retirada" : "Entrega"}
          </span>
          {isPreparing && (
            <span className="text-xs text-brand-ink-soft">
              · {pickedCount}/{detail.items.length} conferidos
            </span>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-brand-ink-soft">Cliente</dt>
            <dd className="font-medium text-brand-ink">{detail.customer_name}</dd>
          </div>
          {detail.promised_to && (
            <div>
              <dt className="text-brand-ink-soft">Prazo</dt>
              <dd className="font-medium text-brand-ink">
                {detail.promised_from ? `${formatDate(detail.promised_from)} a ` : ""}
                {formatDate(detail.promised_to)}
              </dd>
            </div>
          )}
          {detail.address_district && (
            <div>
              <dt className="text-brand-ink-soft">Bairro</dt>
              <dd className="font-medium text-brand-ink">{detail.address_district}</dd>
            </div>
          )}
          {detail.address_reference && (
            <div className="col-span-2">
              <dt className="text-brand-ink-soft">Referência</dt>
              <dd className="font-medium text-brand-ink">{detail.address_reference}</dd>
            </div>
          )}
          {detail.notes && (
            <div className="col-span-2">
              <dt className="text-brand-ink-soft">Obs. do pedido</dt>
              <dd className="font-medium text-brand-ink">{detail.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Items */}
      <section className="rounded-xl border border-brand-line bg-card">
        <div className="border-b border-brand-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
            <Package className="size-4" />
            {detail.items.length} {detail.items.length === 1 ? "item" : "itens"}
          </h2>
        </div>
        <ul className="divide-y divide-brand-line">
          {detail.items.map((item) => (
            <ItemPickRow key={item.id} item={item} shipmentId={detail.id} isPreparing={isPreparing} />
          ))}
        </ul>
      </section>

      {/* Actions */}
      {!isTerminal && !isFinished && (
        <section className="space-y-3">
          {status === "aguardando_disponibilidade" && (
            <form action={startAction.formAction}>
              <input type="hidden" name="shipmentId" value={detail.id} />
              <Button type="submit" variant="navy" className="w-full" disabled={startAction.pending}>
                <ArrowRight /> Iniciar Separação
              </Button>
            </form>
          )}

          {isPreparing && (
            <div className="flex gap-2">
              {isPickup ? (
                <Button
                  variant="navy"
                  className="flex-1"
                  onClick={() => setShowConfirm("retirada")}
                  disabled={finishPickupAction.pending || !allPicked}
                >
                  <CheckCircle /> Pronto para retirada
                </Button>
              ) : (
                <Button
                  variant="navy"
                  className="flex-1"
                  onClick={() => setShowConfirm("envio")}
                  disabled={finishShipAction.pending || !allPicked}
                >
                  <CheckCircle /> Pronto para envio
                </Button>
              )}
            </div>
          )}

          {isPreparing && !allPicked && (
            <p className="text-center text-xs text-brand-ink-soft">
              Confira todos os itens antes de finalizar.
            </p>
          )}

          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowOccurrence(!showOccurrence)}>
            <Plus /> Registrar ocorrência
          </Button>
        </section>
      )}

      {/* Finished state */}
      {isFinished && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-brand-green/20 bg-brand-green/5 py-6 text-center">
          <CheckCircle className="size-8 text-brand-green" />
          <p className="font-heading text-sm font-bold text-brand-green">Separação concluída</p>
          <p className="text-xs text-brand-ink-soft">
            {status === "pronto_para_retirada" ? "Aguardando retirada pelo cliente." : "Aguardando envio."}
          </p>
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-base font-bold text-brand-navy">Confirmar finalização</h3>
            <p className="mt-2 text-sm text-brand-ink-soft">
              {showConfirm === "envio"
                ? "Marcar esta entrega como pronta para envio? O status não poderá ser revertido."
                : "Marcar esta entrega como pronta para retirada? O status não poderá ser revertido."}
            </p>
            <p className="mt-1 text-sm text-brand-ink-soft">
              {detail.order_code} · Entrega {detail.sequence} · {detail.items.length} {detail.items.length === 1 ? "item" : "itens"}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(null)}>
                Cancelar
              </Button>
              <form action={showConfirm === "envio" ? finishShipAction.formAction : finishPickupAction.formAction} className="flex-1" onSubmit={() => setShowConfirm(null)}>
                <input type="hidden" name="shipmentId" value={detail.id} />
                <Button
                  type="submit"
                  variant="navy"
                  className="w-full"
                  disabled={finishShipAction.pending || finishPickupAction.pending}
                >
                  Confirmar
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Occurrence form */}
      {showOccurrence && (
        <section className="rounded-xl border border-brand-line bg-muted/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-brand-ink">Nova ocorrência</h3>
          <form
            action={(fd) => {
              occAction.formAction(fd);
              setOccDesc("");
              setShowOccurrence(false);
            }}
            className="space-y-2"
          >
            <input type="hidden" name="shipmentId" value={detail.id} />
            <label className="block text-xs font-semibold text-brand-ink">
              Tipo
              <select
                name="type"
                value={occType}
                onChange={(e) => setOccType(e.target.value as SeparadorOccurrenceType)}
                className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
              >
                {(Object.entries(SEPARADOR_OCCURRENCE_LABELS) as [SeparadorOccurrenceType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Descrição
              <textarea
                name="description"
                value={occDesc}
                onChange={(e) => setOccDesc(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm min-h-16"
                required
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowOccurrence(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="navy" size="sm" disabled={occAction.pending || !occDesc.trim()}>
                Registrar
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
