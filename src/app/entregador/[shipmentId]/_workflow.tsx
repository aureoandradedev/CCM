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
  ENTREGADOR_OCCURRENCE_TYPES,
  type ActionResult,
} from "@/app/entregador/actions";
import { Button } from "@/components/ui/button";
import { formatDate, shipmentStatusLabel, TONE_CLASS } from "@/lib/orders";
import { SHIPMENT_STATUS_LABEL, OCCURRENCE_LABELS } from "@/lib/shipment-lifecycle";
import type { OccurrenceType } from "@/lib/shipment-lifecycle";
import type { EntregadorShipmentDetail } from "@/lib/entregador/data";
import { cn } from "@/lib/utils";

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
  const statusInfo = shipmentStatusLabel(status);
  const isTerminal = status === "entregue" || status === "cancelado";
  const address = formatAddress(detail);

  return (
    <div className="space-y-4">
      <Link href="/entregador" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">
        <ArrowLeft className="size-3.5" /> Voltar às entregas
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
          {detail.shipped_at && (
            <div>
              <dt className="text-brand-ink-soft">Saiu em</dt>
              <dd className="font-medium text-brand-ink">{formatDate(detail.shipped_at)}</dd>
            </div>
          )}
          {detail.delivered_at && (
            <div>
              <dt className="text-brand-ink-soft">Entregue em</dt>
              <dd className="font-medium text-brand-ink">{formatDate(detail.delivered_at)}</dd>
            </div>
          )}
          {detail.tracking_code && (
            <div className="col-span-2">
              <dt className="text-brand-ink-soft">Rastreio</dt>
              <dd className="font-medium text-brand-ink">{detail.tracking_code}{detail.carrier ? ` (${detail.carrier})` : ""}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Address card */}
      {address && !isPickup && (
        <div className="rounded-xl border border-brand-line bg-card p-4">
          <div className="flex items-start gap-3">
            <Navigation className="mt-0.5 size-5 shrink-0 text-brand-navy" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-brand-navy">Endereço de entrega</p>
              <p className="mt-1 whitespace-pre-line text-sm text-brand-ink">{address}</p>
              {detail.address_reference && (
                <p className="mt-1 text-xs text-brand-ink-soft">Ref: {detail.address_reference}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phone */}
      {detail.customer_phone && (
        <div className="rounded-xl border border-brand-line bg-card p-4">
          <div className="flex items-center gap-3">
            <Phone className="size-5 shrink-0 text-brand-navy" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-brand-navy">Telefone do cliente</p>
              <p className="mt-0.5 text-sm font-medium text-brand-ink select-all">
                {formatPhoneDisplay(detail.customer_phone)}
              </p>
            </div>
            <a
              href={phoneHref(detail.customer_phone)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white active:bg-brand-navy/80"
            >
              <Phone className="size-3.5" /> Ligar
            </a>
          </div>
        </div>
      )}

      {/* Notes */}
      {detail.notes && (
        <div className="rounded-xl border border-brand-line bg-muted/40 p-4">
          <p className="text-xs font-semibold text-brand-ink-soft">Obs. do pedido</p>
          <p className="mt-1 text-sm text-brand-ink">{detail.notes}</p>
        </div>
      )}

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
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-muted">
                <Package className="size-4 text-brand-ink-soft/40" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-ink">{item.name}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-heading text-sm font-bold text-brand-navy">{item.qty}</p>
                <p className="text-[0.65rem] text-brand-ink-soft">{item.unit}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Actions */}
      {!isTerminal && (
        <section className="space-y-3">
          {status === "pronto_para_envio" && !isPickup && (
            <Button
              variant="navy"
              className="w-full"
              onClick={() => setShowConfirm("enviado")}
              disabled={shipAction.pending}
            >
              <Truck /> Saiu para entrega
            </Button>
          )}

          {status === "enviado" && (
            <Button
              variant="navy"
              className="w-full"
              onClick={() => setShowConfirm("entregue")}
              disabled={deliverAction.pending}
            >
              <CheckCircle /> Confirmar entrega
            </Button>
          )}

          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowOccurrence(!showOccurrence)}>
            <Plus /> Registrar ocorrência
          </Button>
        </section>
      )}

      {/* Terminal state */}
      {isTerminal && (
        <div className={cn(
          "flex flex-col items-center gap-2 rounded-xl border py-6 text-center",
          status === "entregue"
            ? "border-brand-green/20 bg-brand-green/5"
            : "border-brand-line bg-muted/40",
        )}>
          {status === "entregue" ? (
            <>
              <CheckCircle className="size-8 text-brand-green" />
              <p className="font-heading text-sm font-bold text-brand-green">Entrega concluída</p>
              {detail.delivered_at && (
                <p className="text-xs text-brand-ink-soft">
                  Entregue em {formatDate(detail.delivered_at)}
                </p>
              )}
            </>
          ) : (
            <>
              <Clock className="size-8 text-brand-ink-soft" />
              <p className="font-heading text-sm font-bold text-brand-ink-soft">Cancelado</p>
            </>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setShowConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-base font-bold text-brand-navy">
              {showConfirm === "enviado" ? "Confirmar saída" : "Confirmar entrega"}
            </h3>
            <p className="mt-2 text-sm text-brand-ink-soft">
              {showConfirm === "enviado"
                ? "Marcar esta entrega como saiu para entrega?"
                : "Confirmar que esta entrega foi realizada?"}
            </p>
            <p className="mt-1 text-sm text-brand-ink-soft">
              {detail.order_code} · Entrega {detail.sequence} · {detail.items.length} {detail.items.length === 1 ? "item" : "itens"}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(null)}>
                Cancelar
              </Button>
              <form
                action={showConfirm === "enviado" ? shipAction.formAction : deliverAction.formAction}
                className="flex-1"
              >
                <input type="hidden" name="shipmentId" value={detail.id} />
                <Button
                  type="submit"
                  variant="navy"
                  className="w-full"
                  disabled={shipAction.pending || deliverAction.pending}
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
                onChange={(e) => setOccType(e.target.value as OccurrenceType)}
                className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
              >
                {ENTREGADOR_OCCURRENCE_TYPES.map((k) => (
                  <option key={k} value={k}>{OCCURRENCE_LABELS[k]}</option>
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
