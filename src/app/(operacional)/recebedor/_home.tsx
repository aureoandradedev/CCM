"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ClipboardCheck, Package, Truck } from "lucide-react";

import { OpKpi, OpStatusBadge, OpEmptyState, OpSearchFilter } from "@/components/operational/operational-ui";
import type { RecebedorPO } from "@/lib/recebedor/data";

interface RecentSession {
  id: string;
  status: string;
  started_at: string;
  supplier_purchase_orders?: { suppliers?: { name?: string | null } } | null;
}

export function RecebedorHome({ pos, sessions }: { pos: RecebedorPO[]; sessions: RecentSession[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = pos;
    if (filter === "in_progress") list = list.filter((p) => p.activeSession);
    if (filter === "pending") list = list.filter((p) => !p.activeSession);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => (p.supplier_name ?? p.supplier_id).toLowerCase().includes(q));
    }
    return list;
  }, [pos, search, filter]);

  const inProgress = pos.filter((p) => p.activeSession).length;

  const filters = [
    { key: "all", label: "Todos", count: pos.length },
    { key: "pending", label: "Aguardando", count: pos.length - inProgress },
    { key: "in_progress", label: "Em andamento", count: inProgress },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <OpKpi label="Na fila" value={pos.length} />
        <OpKpi label="Em conferência" value={inProgress} tone={inProgress > 0 ? "warn" : "default"} />
        <OpKpi label="Concluídas" value={sessions.length} tone="success" />
      </div>

      {/* Search + Filter */}
      <OpSearchFilter
        placeholder="Buscar fornecedor..."
        filters={filters}
        activeFilter={filter}
        onFilterChange={setFilter}
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* PO Cards */}
      {filtered.length === 0 ? (
        <OpEmptyState icon={<Package className="size-12" />} message="Nenhum pedido de compra para conferir." />
      ) : (
        <div className="space-y-3">
          {filtered.map((po) => (
            <Link
              key={po.id}
              href={`/recebedor/${po.id}`}
              className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04] transition-shadow active:shadow-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-bold text-gray-900">
                    {po.supplier_name ?? po.supplier_id}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Ciclo {po.cycle_date} · {po.item_count} {po.item_count === 1 ? "item" : "itens"}
                  </p>
                </div>
                <OpStatusBadge status={po.status} />
              </div>

              <div className="mt-3 flex items-center justify-end">
                {po.activeSession ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                    <Truck className="size-3.5" /> Em andamento
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-navy">
                    <ClipboardCheck className="size-3.5" /> Conferir
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div>
          <h2 className="mb-3 font-heading text-sm font-bold text-gray-700">Recentes</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/[0.04]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {s.supplier_purchase_orders?.suppliers?.name ?? "—"}
                  </p>
                  <p className="text-[0.65rem] text-gray-400">
                    {new Date(s.started_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <OpStatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
