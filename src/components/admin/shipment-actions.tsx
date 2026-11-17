"use client";

import { ArrowRight, Ban, MapPin, Package, Plus, Truck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { logShipmentOccurrence, setShipmentTracking, updateShipmentStatus, type ActionResult } from "@/app/admin/actions";
import { inputCls, textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, shipmentStatusLabel, TONE_CLASS, type OrderShipmentRow, type ShipmentStatus } from "@/lib/orders";
import { SHIPMENT_TRANSITIONS, SHIPMENT_STATUS_LABEL, OCCURRENCE_LABELS, type OccurrenceType } from "@/lib/shipment-lifecycle";
import type { OrderEvent, ShipmentOccurrenceRow } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const EVENT_LABEL: Record<string, string> = {
  shipment_status_changed: "Status alterado",
  shipment_tracking_set: "Rastreio atualizado",
  shipment_occurrence: "Ocorrência",
};

export function ShipmentActionsPanel({
  shipment,
  events,
  occurrences,
}: {
  shipment: OrderShipmentRow;
  events: OrderEvent[];
  occurrences: ShipmentOccurrenceRow[];
}) {
  const [pending, start] = useTransition();
  const [showTracking, setShowTracking] = useState(false);
  const [showOccurrence, setShowOccurrence] = useState(false);
  const [tracking, setTracking] = useState(shipment.tracking_code ?? "");
  const [carrier, setCarrier] = useState(shipment.carrier ?? "");
  const [occType, setOccType] = useState<OccurrenceType>("note");
  const [occDesc, setOccDesc] = useState("");

  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
      setShowTracking(false);
      setShowOccurrence(false);
      setOccDesc("");
    });

  const status = shipment.status as ShipmentStatus;
  const transitions = SHIPMENT_TRANSITIONS[status] ?? [];
  const shipEvents = events.filter((e) => e.shipment_id === shipment.id);

  return (
    <section className="rounded-2xl border border-brand-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-brand-line px-4 py-3">
        {shipment.delivery_method === "pickup" ? (
          <MapPin className="size-4 text-brand-navy" />
        ) : (
          <Truck className="size-4 text-brand-navy" />
        )}
        <span className="text-sm font-semibold text-brand-navy dark:text-foreground">Entrega {shipment.sequence}</span>
        <ShipmentBadge status={shipment.status} />
        {shipment.promised_from && shipment.promised_to ? (
          <span className="ml-auto text-xs text-brand-ink-soft">
            {formatDate(shipment.promised_from)} a {formatDate(shipment.promised_to)}
          </span>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        <dl className="grid gap-1.5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-brand-ink-soft">Rastreio</dt>
            <dd className="font-mono text-xs">{shipment.tracking_code || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-ink-soft">Transportadora</dt>
            <dd className="text-xs">{shipment.carrier || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-ink-soft">Timestamps</dt>
            <dd className="text-xs">
              {shipment.shipped_at ? `Enviado: ${formatDateTime(shipment.shipped_at)}` : ""}
              {shipment.shipped_at && shipment.delivered_at ? " · " : ""}
              {shipment.delivered_at ? `Entregue: ${formatDateTime(shipment.delivered_at)}` : ""}
              {!shipment.shipped_at && !shipment.delivered_at ? "—" : ""}
            </dd>
          </div>
        </dl>

        {transitions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {transitions.filter((t) => t !== "cancelado").map((t) => {
              const fd = new FormData();
              fd.set("shipmentId", shipment.id);
              fd.set("status", t);
              return (
                <Button
                  key={t}
                  variant="outline-navy"
                  size="sm"
                  disabled={pending}
                  onClick={() => go(() => updateShipmentStatus({} as ActionResult, fd))}
                >
                  <ArrowRight /> {SHIPMENT_STATUS_LABEL[t as ShipmentStatus] ?? t}
                </Button>
              );
            })}
            {transitions.includes("cancelado") ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Cancelar entrega ${shipment.sequence}?`)) return;
                  const fd = new FormData();
                  fd.set("shipmentId", shipment.id);
                  fd.set("status", "cancelado");
                  go(() => updateShipmentStatus({} as ActionResult, fd));
                }}
              >
                <Ban /> Cancelar
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setShowTracking(!showTracking)}>
              <Package /> Rastreio
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowOccurrence(!showOccurrence)}>
              <Plus /> Ocorrência
            </Button>
          </div>
        ) : null}

        {showTracking ? (
          <div className="rounded-xl border border-brand-line bg-muted/40 p-3 space-y-2">
            <label className="block text-xs font-semibold text-brand-ink">
              Código de rastreio
              <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Transportadora
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <Button
              size="sm"
              variant="navy"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("shipmentId", shipment.id);
                fd.set("trackingCode", tracking);
                fd.set("carrier", carrier);
                go(() => setShipmentTracking({} as ActionResult, fd));
              }}
            >
              Salvar rastreio
            </Button>
          </div>
        ) : null}

        {showOccurrence ? (
          <div className="rounded-xl border border-brand-line bg-muted/40 p-3 space-y-2">
            <label className="block text-xs font-semibold text-brand-ink">
              Tipo
              <select value={occType} onChange={(e) => setOccType(e.target.value as OccurrenceType)} className={`${inputCls} mt-1`}>
                {(Object.entries(OCCURRENCE_LABELS) as [OccurrenceType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Descrição
              <textarea value={occDesc} onChange={(e) => setOccDesc(e.target.value)} className={`${textareaCls} mt-1 min-h-16`} />
            </label>
            <Button
              size="sm"
              variant="navy"
              disabled={pending || !occDesc.trim()}
              onClick={() => {
                const fd = new FormData();
                fd.set("shipmentId", shipment.id);
                fd.set("type", occType);
                fd.set("description", occDesc);
                go(() => logShipmentOccurrence({} as ActionResult, fd));
              }}
            >
              Registrar ocorrência
            </Button>
          </div>
        ) : null}

        {occurrences.length > 0 ? (
          <div>
            <h4 className="text-xs font-semibold text-brand-ink-soft mb-1">Ocorrências</h4>
            <ol className="space-y-1 text-xs">
              {occurrences.map((o) => (
                <li key={o.id} className="flex gap-2 border-b border-brand-line pb-1 last:border-0">
                  <span className="w-28 shrink-0 text-brand-ink-soft">{formatDateTime(o.occurred_at)}</span>
                  <span className="font-semibold">{OCCURRENCE_LABELS[o.type] ?? o.type}</span>
                  <span className="text-brand-ink-soft">{o.description}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {shipEvents.length > 0 ? (
          <div>
            <h4 className="text-xs font-semibold text-brand-ink-soft mb-1">Timeline</h4>
            <ol className="space-y-1 text-xs">
              {shipEvents.map((e) => (
                <li key={e.id} className="flex gap-2 border-b border-brand-line pb-1 last:border-0">
                  <span className="w-28 shrink-0 text-brand-ink-soft">{formatDateTime(e.created_at)}</span>
                  <span className="font-semibold">{EVENT_LABEL[e.type] ?? e.type}</span>
                  {e.data && typeof e.data === "object" && "from" in e.data && "to" in e.data ? (
                    <span className="text-brand-ink-soft">{String(e.data.from)} → {String(e.data.to)}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ShipmentBadge({ status }: { status: string }) {
  const s = shipmentStatusLabel(status);
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold", TONE_CLASS[s.tone])}>{s.label}</span>;
}
