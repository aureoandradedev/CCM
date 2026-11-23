"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { CheckCircle, MapPin, Package, Truck } from "lucide-react";

import { OpKpi, OpStatusBadge, OpEmptyState, OpSearchFilter, OpLateBadge, isDueToday } from "@/components/operational/operational-ui";
import { formatDate } from "@/lib/orders";
import type { EntregadorShipmentCard } from "@/lib/entregador/data";

export function EntregadorHome({ active, recent }: { active: EntregadorShipmentCard[]; recent: EntregadorShipmentCard[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = active;
    if (filter === "pronto") list = list.filter((s) => s.status === "pronto_para_envio");
    if (filter === "enviado") list = list.filter((s) => s.status === "enviado");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.order_code.toLowerCase().includes(q) ||
          s.customer_name.toLowerCase().includes(q) ||
          (s.address_district ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [active, search, filter]);

  const pronto = active.filter((s) => s.status === "pronto_para_envio").length;
  const enviado = active.filter((s) => s.status === "enviado").length;

  const filters = [
    { key: "all", label: "Todas", count: active.length },
    { key: "pronto", label: "Pronto p/ envio", count: pronto },
    { key: "enviado", label: "Em rota", count: enviado },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <OpKpi label="Pendentes" value={active.length} />
        <OpKpi label="Pronto p/ sair" value={pronto} tone={pronto > 0 ? "warn" : "default"} />
        <OpKpi label="Em rota" value={enviado} tone={enviado > 0 ? "warn" : "default"} />
      </div>

      {/* Search + Filters */}
      <OpSearchFilter
        placeholder="Buscar pedido, cliente ou bairro..."
        filters={filters}
        activeFilter={filter}
        onFilterChange={setFilter}
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Cards */}
      {filtered.length === 0 ? (
        <OpEmptyState icon={<Truck className="size-12" />} message="Nenhuma entrega atribuída a você." />
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
                  {s.address_district && (
                    <p className="mt-0.5 text-xs font-medium text-gray-500">
                      {s.address_district}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <OpLateBadge promisedTo={s.promised_to} />
                    {isDueToday(s.promised_to) && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold text-amber-700">
                        Vence hoje
                      </span>
                    )}
                  </div>
                </div>
                <OpStatusBadge status={s.status} />
              </div>

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
          <h2 className="mb-3 font-heading text-sm font-bold text-gray-700">Concluídas recentemente</h2>
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
