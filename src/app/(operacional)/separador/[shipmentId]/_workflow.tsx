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
import { formatDate } from "@/lib/orders";
import { SHIPMENT_STATUS_LABEL, OCCURRENCE_LABELS } from "@/lib/shipment-lifecycle";
import type { SeparadorShipmentDetail } from "@/lib/separador/data";
import { cn } from "@/lib/utils";
import { OpStatusBadge, OpProgress, OpConfirmModal, OpLateBadge } from "@/components/operational/operational-ui";

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
              "flex size-8 items-center justify-center rounded-xl border-2 transition-all",
              isPicked
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-gray-200 bg-white text-transparent hover:border-brand-navy/40",
            )}
            aria-label={isPicked ? `${item.name} conferido` : `Conferir ${item.name}`}
          >
            <Check className="size-4" strokeWidth={3} />
          </button>
        </form>
      )}

      {item.image ? (
        <Image src={item.image} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-black/[0.06]" />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gray-50 ring-1 ring-black/[0.06]">
          <Package className="size-5 text-gray-300" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", isPicked ? "text-emerald-700" : "text-gray-800")}>{item.name}</p>
        {item.sku && <p className="text-[0.65rem] text-gray-400">SKU: {item.sku}</p>}
        {isPreparing && item.picked_qty !== null && item.picked_qty > 0 && (
          <p className="text-[0.65rem] font-semibold text-emerald-600">
            Separado: {item.picked_qty}/{item.qty}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-heading text-sm font-bold text-brand-navy">{item.qty}</p>
        <p className="text-[0.65rem] text-gray-400">{item.unit}</p>
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
  const isTerminal = status === "entregue" || status === "cancelado";
  const isFinished = status === "pronto_para_envio" || status === "pronto_para_retirada";
  const isPreparing = status === "preparando";

  const pickedCount = detail.items.filter((i) => i.picked_qty !== null && i.picked_qty >= i.qty).length;
  const allPicked = pickedCount === detail.items.length && detail.items.length > 0;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link href="/separador" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-brand-navy">
        <ArrowLeft className="size-3.5" /> Voltar à fila
      </Link>

      {/* Header */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", isPickup ? "bg-teal-50" : "bg-brand-navy/10")}>
            {isPickup ? <MapPin className="size-5 text-teal-600" /> : <Truck className="size-5 text-brand-navy" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-base font-bold text-gray-900">
              {detail.order_code} · Entrega {detail.sequence}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <OpStatusBadge status={status} />
              <span className="text-xs text-gray-500">{isPickup ? "Retirada" : "Entrega"}</span>
              <OpLateBadge promisedTo={detail.promised_to} />
            </div>
          </div>
        </div>

        {isPreparing && (
          <div className="mt-4">
            <OpProgress current={pickedCount} total={detail.items.length} />
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-gray-400">Cliente</dt>
            <dd className="font-medium text-gray-800">{detail.customer_name}</dd>
          </div>
          {detail.promised_to && (
            <div>
              <dt className="text-gray-400">Prazo</dt>
              <dd className="font-medium text-gray-800">
                {detail.promised_from ? `${formatDate(detail.promised_from)} a ` : ""}
                {formatDate(detail.promised_to)}
              </dd>
            </div>
          )}
          {detail.address_district && (
            <div>
              <dt className="text-gray-400">Bairro</dt>
              <dd className="font-medium text-gray-800">{detail.address_district}</dd>
            </div>
          )}
          {detail.address_reference && (
            <div className="col-span-2">
              <dt className="text-gray-400">Referência</dt>
              <dd className="font-medium text-gray-800">{detail.address_reference}</dd>
            </div>
          )}
          {detail.notes && (
            <div className="col-span-2">
              <dt className="text-gray-400">Obs. do pedido</dt>
              <dd className="font-medium text-gray-800">{detail.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Items */}
      <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-brand-navy">
            <Package className="size-4" />
            {detail.items.length} {detail.items.length === 1 ? "item" : "itens"}
          </h2>
        </div>
        <ul className="divide-y divide-gray-100">
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
              <button
                type="submit"
                disabled={startAction.pending}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
              >
                <ArrowRight className="size-4" /> Iniciar Separação
              </button>
            </form>
          )}

          {isPreparing && (
            <div className="flex gap-3">
              {isPickup ? (
                <button
                  type="button"
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-navy text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
                  onClick={() => setShowConfirm("retirada")}
                  disabled={finishPickupAction.pending || !allPicked}
                >
                  <CheckCircle className="size-4" /> Pronto para retirada
                </button>
              ) : (
                <button
                  type="button"
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-navy text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
                  onClick={() => setShowConfirm("envio")}
                  disabled={finishShipAction.pending || !allPicked}
                >
                  <CheckCircle className="size-4" /> Pronto para envio
                </button>
              )}
            </div>
          )}

          {isPreparing && !allPicked && (
            <p className="text-center text-xs font-medium text-gray-400">
              Confira todos os itens antes de finalizar.
            </p>
          )}

          <button
            type="button"
            className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-gray-500 ring-1 ring-black/[0.06] transition-colors hover:bg-gray-50"
            onClick={() => setShowOccurrence(!showOccurrence)}
          >
            <Plus className="size-3.5" /> Registrar ocorrência
          </button>
        </section>
      )}

      {/* Finished state */}
      {isFinished && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-emerald-50 py-8 text-center ring-1 ring-emerald-200/50">
          <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle className="size-7 text-emerald-600" />
          </div>
          <p className="font-heading text-sm font-bold text-emerald-700">Separação concluída</p>
          <p className="text-xs text-gray-500">
            {status === "pronto_para_retirada" ? "Aguardando retirada pelo cliente." : "Aguardando envio."}
          </p>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-bold text-brand-navy">Confirmar finalização</h3>
            <p className="mt-2 text-sm text-gray-500">
              {showConfirm === "envio"
                ? "Marcar esta entrega como pronta para envio? O status não poderá ser revertido."
                : "Marcar esta entrega como pronta para retirada? O status não poderá ser revertido."}
            </p>
            <p className="mt-1 text-sm font-medium text-gray-700">
              {detail.order_code} · Entrega {detail.sequence} · {detail.items.length} {detail.items.length === 1 ? "item" : "itens"}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-gray-500 ring-1 ring-black/[0.08] transition-colors hover:bg-gray-50"
              >
                Cancelar
              </button>
              <form action={showConfirm === "envio" ? finishShipAction.formAction : finishPickupAction.formAction} className="flex-1" onSubmit={() => setShowConfirm(null)}>
                <input type="hidden" name="shipmentId" value={detail.id} />
                <button
                  type="submit"
                  disabled={finishShipAction.pending || finishPickupAction.pending}
                  className="w-full rounded-xl bg-brand-navy px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
                >
                  Confirmar
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Occurrence form */}
      {showOccurrence && (
        <section className="space-y-3 rounded-2xl bg-gray-50 p-5 ring-1 ring-black/[0.04]">
          <h3 className="text-sm font-bold text-gray-800">Nova ocorrência</h3>
          <form
            action={(fd) => {
              occAction.formAction(fd);
              setOccDesc("");
              setShowOccurrence(false);
            }}
            className="space-y-3"
          >
            <input type="hidden" name="shipmentId" value={detail.id} />
            <label className="block text-xs font-semibold text-gray-600">
              Tipo
              <select
                name="type"
                value={occType}
                onChange={(e) => setOccType(e.target.value as SeparadorOccurrenceType)}
                className="mt-1.5 block w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/[0.06] outline-none focus:ring-2 focus:ring-brand-navy/30"
              >
                {(Object.entries(SEPARADOR_OCCURRENCE_LABELS) as [SeparadorOccurrenceType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              Descrição
              <textarea
                name="description"
                value={occDesc}
                onChange={(e) => setOccDesc(e.target.value)}
                className="mt-1.5 block min-h-20 w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/[0.06] outline-none focus:ring-2 focus:ring-brand-navy/30"
                required
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowOccurrence(false)}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 ring-1 ring-black/[0.08] transition-colors hover:bg-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={occAction.pending || !occDesc.trim()}
                className="flex-1 rounded-xl bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
              >
                Registrar
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
