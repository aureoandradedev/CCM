"use client";

import { useState, useMemo, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownUp,
  Bell,
  CheckCircle,
  ChevronRight,
  Clock,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  confirmOrder,
  rejectOrder,
  sendReminder,
  type ActionResult,
  type ReminderRow,
} from "@/app/compras/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime, methodLabel, statusLabel, TONE_CLASS } from "@/lib/orders";
import type { OrderRow } from "@/lib/orders";
import { cn } from "@/lib/utils";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

function agingLabel(createdAt: string): { text: string; tone: "ok" | "warn" | "danger" } {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return { text: "agora", tone: "ok" };
  if (mins < 60) return { text: `${mins} min`, tone: mins < 10 ? "ok" : mins < 30 ? "warn" : "danger" };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { text: `${hrs}h ${mins % 60}min`, tone: "danger" };
  const days = Math.floor(hrs / 24);
  return { text: `${days}d ${hrs % 24}h`, tone: "danger" };
}

const AGING_TONE: Record<string, string> = {
  ok: "text-brand-green",
  warn: "text-brand-orange",
  danger: "text-brand-red",
};

function OrderCard({
  order,
  reminders,
}: {
  order: OrderRow;
  reminders: ReminderRow[];
}) {
  const [showReject, setShowReject] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [sendingReminder, startReminder] = useTransition();

  const [, confirmAction, confirming] = useActionState(async () => {
    const r = await confirmOrder(order.id);
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, {} as ActionResult);

  const [, rejectAction, rejecting] = useActionState(async () => {
    if (motivo.trim().length < 3) { toast.error("Informe o motivo."); return {}; }
    const r = await rejectOrder(order.id, motivo.trim());
    if (r.error) toast.error(r.error);
    else if (r.ok) toast.success(r.ok);
    return r;
  }, {} as ActionResult);

  const info = statusLabel(order.order_status);
  const aging = agingLabel(order.created_at);
  const nextReminderNo = reminders.length + 1;

  const handleReminder = () => {
    startReminder(async () => {
      const r = await sendReminder(order.id, nextReminderNo);
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
    });
  };

  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-sm font-bold text-brand-navy">{order.code}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.6rem] font-semibold", TONE_CLASS[info.tone])}>
              {info.label}
            </span>
            <span className={cn("inline-flex items-center gap-1 text-[0.65rem] font-semibold", AGING_TONE[aging.tone])}>
              <Clock className="size-3" /> {aging.text}
            </span>
            {reminders.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 px-2 py-0.5 text-[0.6rem] font-semibold text-brand-navy">
                <Bell className="size-3" /> {reminders.length} lembrete(s)
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-brand-ink">{order.customer.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
            <span>{formatBRL(order.total_centavos)}</span>
            <span>{methodLabel(order.payment_method)}</span>
            <span>{order.items_count} {order.items_count === 1 ? "item" : "itens"}</span>
            <span>{order.delivery_method === "pickup" ? "Retirada" : "Entrega"}</span>
            <span>{formatDateTime(order.created_at)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="navy" size="sm" render={<Link href={`/compras/confirmacoes/${order.id}`} />}>
            <CheckCircle className="size-4" /> Revisar itens <ChevronRight className="size-4" />
          </Button>
          <form action={confirmAction}>
            <Button type="submit" variant="outline" size="sm" disabled={confirming || rejecting} title="Confirmar tudo sem revisão">
              <CheckCircle className="size-4" /> Confirmar tudo
            </Button>
          </form>
          <Button variant="outline" size="sm" onClick={() => setShowReject(!showReject)} disabled={confirming || rejecting}>
            <XCircle className="size-4" /> Rejeitar
          </Button>
          {nextReminderNo <= 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReminder}
              disabled={sendingReminder}
              title={`Registrar lembrete #${nextReminderNo}`}
            >
              <Bell className="size-4" /> {sendingReminder ? "..." : `Lembrete #${nextReminderNo}`}
            </Button>
          )}
        </div>
      </div>

      {aging.tone === "danger" && reminders.length === 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-red/10 px-3 py-1.5 text-xs font-medium text-brand-red">
          <AlertTriangle className="size-3.5" />
          Aguardando confirmação há mais de 30 minutos sem lembrete.
        </div>
      )}

      {showReject && (
        <form action={rejectAction} className="mt-3 flex items-end gap-2 border-t border-brand-line pt-3">
          <label className="flex-1">
            <span className="text-xs font-semibold text-brand-ink">Motivo da rejeição</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-brand-line bg-card px-3 py-2 text-sm"
              placeholder="Ex: produto indisponível"
              required
              minLength={3}
            />
          </label>
          <Button type="submit" variant="destructive" size="sm" disabled={rejecting || motivo.trim().length < 3}>
            Confirmar rejeição
          </Button>
        </form>
      )}
    </div>
  );
}

export function ConfirmationList({
  orders,
  reminders,
  initialSearch,
  initialSort,
}: {
  orders: OrderRow[];
  reminders: Record<string, ReminderRow[]>;
  initialSearch: string;
  initialSort: "oldest" | "newest";
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState(initialSort);

  const filtered = useMemo(() => {
    let list = orders;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.code.toLowerCase().includes(q) ||
          o.customer.name.toLowerCase().includes(q) ||
          o.customer.phone?.includes(q),
      );
    }

    if (sort === "newest") {
      list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return list;
  }, [orders, search, sort]);

  const updateUrl = (q: string, s: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (s !== "oldest") params.set("sort", s);
    const qs = params.toString();
    router.replace(`/compras/confirmacoes${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-brand-line bg-muted/40 py-12 text-center">
        <CheckCircle className="mx-auto size-10 text-brand-green" />
        <p className="mt-3 font-heading text-sm font-bold text-brand-ink">Nenhum pedido aguardando confirmação</p>
        <p className="mt-1 text-xs text-brand-ink-soft">Novos pedidos aparecerão aqui automaticamente.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input
            type="search"
            placeholder="Buscar por código, nome ou telefone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              updateUrl(e.target.value, sort);
            }}
            className="w-full rounded-lg border border-brand-line bg-card py-2 pl-9 pr-3 text-sm placeholder:text-brand-ink-soft"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = sort === "oldest" ? "newest" : "oldest";
            setSort(next);
            updateUrl(search, next);
          }}
          className="gap-1.5"
        >
          <ArrowDownUp className="size-3.5" />
          {sort === "oldest" ? "Mais antigos" : "Mais recentes"}
        </Button>
        <span className="text-xs text-brand-ink-soft">
          {filtered.length} de {orders.length}
        </span>
      </div>

      {/* Stats bar */}
      <AgingStats orders={orders} />

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-brand-line bg-muted/40 py-8 text-center">
          <Search className="mx-auto size-8 text-brand-ink-soft" />
          <p className="mt-2 text-sm text-brand-ink-soft">Nenhum resultado para &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} reminders={reminders[o.id] ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgingStats({ orders }: { orders: OrderRow[] }) {
  const now = Date.now();
  let under10 = 0;
  let under30 = 0;
  let over30 = 0;

  for (const o of orders) {
    const mins = (now - new Date(o.created_at).getTime()) / 60_000;
    if (mins < 10) under10++;
    else if (mins < 30) under30++;
    else over30++;
  }

  return (
    <div className="flex flex-wrap gap-3 text-xs font-semibold">
      {under10 > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-green/10 px-3 py-1 text-brand-green">
          <Clock className="size-3" /> &lt;10 min: {under10}
        </span>
      )}
      {under30 > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/10 px-3 py-1 text-brand-orange">
          <Clock className="size-3" /> 10-30 min: {under30}
        </span>
      )}
      {over30 > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-red/10 px-3 py-1 text-brand-red">
          <AlertTriangle className="size-3" /> &gt;30 min: {over30}
        </span>
      )}
    </div>
  );
}
