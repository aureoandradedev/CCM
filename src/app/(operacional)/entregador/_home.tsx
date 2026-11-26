"use client";

import { useState, useMemo, useActionState } from "react";
import Link from "next/link";
import { CheckCircle, MapPin, Package, Truck, UserPlus, UserX } from "lucide-react";

import { OpKpi, OpStatusBadge, OpEmptyState, OpSearchFilter, OpLateBadge, isDueToday } from "@/components/operational/operational-ui";
import { formatDate } from "@/lib/orders";
import type { EntregadorShipmentCard } from "@/lib/entregador/data";
import type { DriverOption } from "@/lib/separador/data";
import { useIsAdminInEntregador } from "./role-context";
import { assignDriverFromDelivery } from "./actions";
import type { ActionResult } from "./constants";

function DriverAssignInline({
  shipmentId,
  drivers,
  currentDriverId,
}: {
  shipmentId: string;
  drivers: DriverOption[];
  currentDriverId: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(assignDriverFromDelivery, {});
  const [driverId, setDriverId] = useState(currentDriverId ?? "");

  return (
    <form
      action={formAction}
      className="flex items-center gap-2"
      onClick={(e) => e.preventDefault()}
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <select
        name="driverId"
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">Selecionar...</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.full_name || d.email}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || !driverId}
        onClick={(e) => {
          e.stopPropagation();
          const form = e.currentTarget.closest("form")!;
          formAction(new FormData(form));
        }}
        className="flex h-8 items-center gap-1 rounded-lg bg-brand-navy px-3 text-xs font-bold text-white disabled:opacity-50"
      >
        <UserPlus className="size-3.5" />
        {currentDriverId ? "Reatribuir" : "Atribuir"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function EntregadorHome({
  active,
  recent,
  drivers = [],
}: {
  active: EntregadorShipmentCard[];
  recent: EntregadorShipmentCard[];
  drivers?: DriverOption[];
}) {
  const isAdmin = useIsAdminInEntregador();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = active;
    if (filter === "pronto") list = list.filter((s) => s.status === "pronto_para_envio");
    if (filter === "enviado") list = list.filter((s) => s.status === "enviado");
    if (filter === "sem_entregador") list = list.filter((s) => !s.assigned_to);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.order_code.toLowerCase().includes(q) ||
          s.customer_name.toLowerCase().includes(q) ||
          (s.address_district ?? "").toLowerCase().includes(q) ||
          (s.address_city ?? "").toLowerCase().includes(q) ||
          (s.assigned_to_name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [active, search, filter]);

  const pronto = active.filter((s) => s.status === "pronto_para_envio").length;
  const enviado = active.filter((s) => s.status === "enviado").length;
  const semEntregador = active.filter((s) => !s.assigned_to).length;

  const filters = isAdmin
    ? [
        { key: "all", label: "Todas", count: active.length },
        { key: "sem_entregador", label: "Sem entregador", count: semEntregador },
        { key: "pronto", label: "Pronto p/ envio", count: pronto },
        { key: "enviado", label: "Em rota", count: enviado },
      ]
    : [
        { key: "all", label: "Todas", count: active.length },
        { key: "pronto", label: "Pronto p/ envio", count: pronto },
        { key: "enviado", label: "Em rota", count: enviado },
      ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className={`grid gap-3 ${isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        <OpKpi label="Pendentes" value={active.length} />
        <OpKpi label="Pronto p/ sair" value={pronto} tone={pronto > 0 ? "warn" : "default"} />
        <OpKpi label="Em rota" value={enviado} tone={enviado > 0 ? "warn" : "default"} />
        {isAdmin && (
          <OpKpi label="Sem entregador" value={semEntregador} tone={semEntregador > 0 ? "warn" : "default"} />
        )}
      </div>

      {/* Search + Filters */}
      <OpSearchFilter
        placeholder={isAdmin ? "Buscar pedido, cliente, bairro ou entregador..." : "Buscar pedido, cliente ou bairro..."}
        filters={filters}
        activeFilter={filter}
        onFilterChange={setFilter}
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Cards */}
      {filtered.length === 0 ? (
        <OpEmptyState
          icon={<Truck className="size-12" />}
          message={isAdmin ? "Nenhuma entrega ativa encontrada." : "Nenhuma entrega atribuída a você."}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/entregador/${s.id}`}
              className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04] transition-shadow active:shadow-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {s.delivery_method === "pickup" ? (
                      <MapPin className="size-4 shrink-0 text-teal-600" />
                    ) : (
                      <Truck className="size-4 shrink-0 text-brand-navy" />
                    )}
                    <p className="truncate font-heading text-sm font-bold text-gray-900">
                      {s.order_code} · {s.customer_name}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Entrega {s.sequence} · {s.item_count} {s.item_count === 1 ? "item" : "itens"}
                    {s.promised_to && ` · até ${formatDate(s.promised_to)}`}
                  </p>
                  {(s.address_district || s.address_city) && (
                    <p className="mt-0.5 text-xs font-medium text-gray-500">
                      {[s.address_district, s.address_city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <OpLateBadge promisedTo={s.promised_to} />
                    {isDueToday(s.promised_to) && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold text-amber-700">
                        Vence hoje
                      </span>
                    )}
                    {isAdmin && !s.assigned_to && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] font-bold text-red-700">
                        <UserX className="size-3" /> Sem entregador
                      </span>
                    )}
                    {isAdmin && s.assigned_to_name && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[0.65rem] font-bold text-blue-700">
                        <Truck className="size-3" /> {s.assigned_to_name}
                      </span>
                    )}
                  </div>
                </div>
                <OpStatusBadge status={s.status} />
              </div>

              {isAdmin && drivers.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <DriverAssignInline
                    shipmentId={s.id}
                    drivers={drivers}
                    currentDriverId={s.assigned_to}
                  />
                </div>
              )}

              <div className="mt-3 flex items-center justify-end">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-navy">
                  {s.status === "enviado" ? (
                    <><CheckCircle className="size-3.5" /> Confirmar entrega</>
                  ) : (
                    <><Package className="size-3.5" /> Ver detalhes</>
                  )}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 font-heading text-sm font-bold text-gray-700">
            {isAdmin ? "Concluídas recentemente (todas)" : "Concluídas recentemente"}
          </h2>
          <div className="space-y-2">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/entregador/${s.id}`}
                className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.04] active:shadow-none"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {s.order_code} · {s.customer_name}
                  </p>
                  <p className="text-[0.65rem] text-gray-400">
                    Entrega {s.sequence} · {s.delivery_method === "pickup" ? "Retirada" : "Entrega"}
                    {isAdmin && s.assigned_to_name && ` · ${s.assigned_to_name}`}
                  </p>
                </div>
                <OpStatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
