"use client";

import Link from "next/link";
import {
  ArrowLeft, CheckCircle, Clock, MapPin, Navigation, Package,
  Phone, Plus, Truck,
} from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import {
  markShipped, markDelivered,
  logEntregadorOccurrence,
} from "@/app/entregador/actions";
import { ENTREGADOR_OCCURRENCE_TYPES, type ActionResult } from "@/app/entregador/constants";
import { formatDate } from "@/lib/orders";
import { SHIPMENT_STATUS_LABEL, OCCURRENCE_LABELS } from "@/lib/shipment-lifecycle";
import type { OccurrenceType } from "@/lib/shipment-lifecycle";
import type { EntregadorShipmentDetail } from "@/lib/entregador/data";
import { cn } from "@/lib/utils";
import { OpStatusBadge, OpLateBadge } from "@/components/operational/operational-ui";

const initial: ActionResult = {};

function useAction(action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>) {
  const [state, formAction, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, initial);
  return { state, formAction, pending };
}

function formatAddress(d: EntregadorShipmentDetail): string | null {
  const parts: string[] = [];
  if (d.address_street) {
    let line = d.address_street;
    if (d.address_number) line += `, ${d.address_number}`;
    if (d.address_complement) line += ` - ${d.address_complement}`;
    parts.push(line);
  }
  if (d.address_district) parts.push(d.address_district);
  const cityState = [d.address_city, d.address_state].filter(Boolean).join(" - ");
  if (cityState) parts.push(cityState);
  if (d.address_cep) parts.push(`CEP ${d.address_cep}`);
  return parts.length > 0 ? parts.join("\n") : null;
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function phoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `tel:+55${digits}`;
}

export function EntregadorWorkflow({ detail }: { detail: EntregadorShipmentDetail }) {
  const [showConfirm, setShowConfirm] = useState<"enviado" | "entregue" | null>(null);
  const [showOccurrence, setShowOccurrence] = useState(false);
  const [occType, setOccType] = useState<OccurrenceType>("note");
  const [occDesc, setOccDesc] = useState("");

  const shipAction = useAction(markShipped);
  const deliverAction = useAction(markDelivered);
  const occAction = useAction(logEntregadorOccurrence);

  const { status, delivery_method } = detail;
  const isPickup = delivery_method === "pickup";
  const isTerminal = status === "entregue" || status === "cancelado";
  const address = formatAddress(detail);

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link href="/entregador" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-brand-navy">
        <ArrowLeft className="size-3.5" /> Voltar às entregas
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
          {detail.shipped_at && (
            <div>
              <dt className="text-gray-400">Saiu em</dt>
              <dd className="font-medium text-gray-800">{formatDate(detail.shipped_at)}</dd>
            </div>
          )}
          {detail.delivered_at && (
            <div>
              <dt className="text-gray-400">Entregue em</dt>
              <dd className="font-medium text-gray-800">{formatDate(detail.delivered_at)}</dd>
            </div>
          )}
          {detail.tracking_code && (
            <div className="col-span-2">
              <dt className="text-gray-400">Rastreio</dt>
              <dd className="font-medium text-gray-800">{detail.tracking_code}{detail.carrier ? ` (${detail.carrier})` : ""}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Address card */}
      {address && !isPickup && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50">
              <Navigation className="size-4 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-brand-navy">Endereço de entrega</p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-gray-700">{address}</p>
              {detail.address_reference && (
                <p className="mt-1 text-xs text-gray-400">Ref: {detail.address_reference}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phone */}
      {detail.customer_phone && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
              <Phone className="size-4 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-brand-navy">Telefone do cliente</p>
              <p className="mt-0.5 text-sm font-medium text-gray-800 select-all">
                {formatPhoneDisplay(detail.customer_phone)}
              </p>
            </div>
            <a
              href={phoneHref(detail.customer_phone)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-navy px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors active:bg-brand-navy/80"
            >
              <Phone className="size-3.5" /> Ligar
            </a>
          </div>
        </div>
      )}

      {/* Notes */}
      {detail.notes && (
        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/[0.04]">
          <p className="text-xs font-bold text-gray-500">Obs. do pedido</p>
          <p className="mt-1.5 text-sm text-gray-700">{detail.notes}</p>
        </div>
      )}

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
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 ring-1 ring-black/[0.06]">
                <Package className="size-4 text-gray-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">{item.name}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-heading text-sm font-bold text-brand-navy">{item.qty}</p>
                <p className="text-[0.65rem] text-gray-400">{item.unit}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Actions */}
      {!isTerminal && (
        <section className="space-y-3">
          {status === "pronto_para_envio" && !isPickup && (
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
              onClick={() => setShowConfirm("enviado")}
              disabled={shipAction.pending}
            >
              <Truck className="size-4" /> Saiu para entrega
            </button>
          )}

          {status === "enviado" && (
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
              onClick={() => setShowConfirm("entregue")}
              disabled={deliverAction.pending}
            >
              <CheckCircle className="size-4" /> Confirmar entrega
            </button>
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

      {/* Terminal state */}
      {isTerminal && (
        <div className={cn(
          "flex flex-col items-center gap-3 rounded-2xl py-8 text-center ring-1",
          status === "entregue"
            ? "bg-emerald-50 ring-emerald-200/50"
            : "bg-gray-50 ring-black/[0.04]",
        )}>
          {status === "entregue" ? (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle className="size-7 text-emerald-600" />
              </div>
              <p className="font-heading text-sm font-bold text-emerald-700">Entrega concluída</p>
              {detail.delivered_at && (
                <p className="text-xs text-gray-500">
                  Entregue em {formatDate(detail.delivered_at)}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-gray-100">
                <Clock className="size-7 text-gray-400" />
              </div>
              <p className="font-heading text-sm font-bold text-gray-500">Cancelado</p>
            </>
          )}
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-bold text-brand-navy">
              {showConfirm === "enviado" ? "Confirmar saída" : "Confirmar entrega"}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {showConfirm === "enviado"
                ? "Marcar esta entrega como saiu para entrega?"
                : "Confirmar que esta entrega foi realizada?"}
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
              <form
                action={showConfirm === "enviado" ? shipAction.formAction : deliverAction.formAction}
                onSubmit={() => setShowConfirm(null)}
                className="flex-1"
              >
                <input type="hidden" name="shipmentId" value={detail.id} />
                <button
                  type="submit"
                  disabled={shipAction.pending || deliverAction.pending}
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
                onChange={(e) => setOccType(e.target.value as OccurrenceType)}
                className="mt-1.5 block w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/[0.06] outline-none focus:ring-2 focus:ring-brand-navy/30"
              >
                {ENTREGADOR_OCCURRENCE_TYPES.map((k) => (
                  <option key={k} value={k}>{OCCURRENCE_LABELS[k]}</option>
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
