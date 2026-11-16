"use client";

import { useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";

import { NoMasterActions, ExceptionBadge, ResolveExceptionForm } from "../_components";
import type { PendenciaRow, PendenciaMatchRow, PendenciaExceptionRow } from "@/lib/admin/compras-data";

const REASON_BADGES: Record<string, { label: string; cls: string }> = {
  "Sem produto mestre": { label: "Não identificado", cls: "bg-pink-100 text-pink-800" },
  "Revisão manual": { label: "Verificar correspondência", cls: "bg-amber-100 text-amber-800" },
  "Match sugerido": { label: "Correspondência provável", cls: "bg-blue-100 text-blue-800" },
};

type TypeFilter = "all" | "matching" | "exception";
type ReasonFilter = "all" | "match_sugerido" | "revisao_manual" | "normalizado";

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface Props {
  items: PendenciaRow[];
  matchCount: number;
  exceptionCount: number;
  suppliers: { id: string; name: string }[];
  catalogs: { id: string; supplier_id: string; source_name: string | null; supplier_name: string; created_at: string }[];
}

export function PendenciasClient({ items, matchCount, exceptionCount, suppliers, catalogs }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [catalogFilter, setCatalogFilter] = useState<string>("all");

  const hasFilters = search !== "" || typeFilter !== "all" || reasonFilter !== "all" || supplierFilter !== "all" || catalogFilter !== "all";

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return items.filter((item) => {
      if (typeFilter === "matching" && item.kind !== "matching") return false;
      if (typeFilter === "exception" && item.kind !== "exception") return false;

      if (reasonFilter !== "all" && item.kind === "matching") {
        const m = item as PendenciaMatchRow;
        if (m.match_status !== reasonFilter) return false;
      }
      if (reasonFilter !== "all" && item.kind === "exception") return false;

      if (supplierFilter !== "all") {
        if (item.kind === "matching") {
          if ((item as PendenciaMatchRow).supplier_id !== supplierFilter) return false;
        } else {
          if ((item as PendenciaExceptionRow).supplier_id !== supplierFilter) return false;
        }
      }

      if (catalogFilter !== "all" && item.kind === "matching") {
        if ((item as PendenciaMatchRow).catalog_id !== catalogFilter) return false;
      }
      if (catalogFilter !== "all" && item.kind === "exception") return false;

      if (q) {
        const title = normalize(item.title);
        const supplier = normalize(item.supplier_name);
        const sku = item.kind === "matching" ? normalize((item as PendenciaMatchRow).supplier_sku ?? "") : "";
        const ean = item.kind === "matching" ? normalize((item as PendenciaMatchRow).ean ?? "") : "";
        const master = item.kind === "matching" ? normalize((item as PendenciaMatchRow).master_product_name ?? "") : "";
        if (!title.includes(q) && !supplier.includes(q) && !sku.includes(q) && !ean.includes(q) && !master.includes(q)) return false;
      }

      return true;
    });
  }, [items, search, typeFilter, reasonFilter, supplierFilter, catalogFilter]);

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setReasonFilter("all");
    setSupplierFilter("all");
    setCatalogFilter("all");
  }

  const filteredMatchCount = filtered.filter((i) => i.kind === "matching").length;
  const filteredExceptionCount = filtered.filter((i) => i.kind === "exception").length;

  return (
    <>
      {/* Search + filters bar */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-fg/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, SKU, EAN ou fornecedor..."
            className="h-10 w-full rounded-lg border border-brand-line bg-white pl-10 pr-4 text-sm text-brand-fg placeholder:text-brand-fg/40 focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-fg/40 hover:text-brand-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-4 text-brand-fg/40" />

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="h-8 rounded-md border border-brand-line bg-white px-2 text-xs text-brand-fg focus:border-brand-navy focus:outline-none"
          >
            <option value="all">Tipo: Todos</option>
            <option value="matching">Identificação ({matchCount})</option>
            <option value="exception">Exceções ({exceptionCount})</option>
          </select>

          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value as ReasonFilter)}
            className="h-8 rounded-md border border-brand-line bg-white px-2 text-xs text-brand-fg focus:border-brand-navy focus:outline-none"
          >
            <option value="all">Status: Todos</option>
            <option value="match_sugerido">Correspondência provável</option>
            <option value="revisao_manual">Verificar correspondência</option>
            <option value="normalizado">Não identificado</option>
          </select>

          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-8 max-w-[240px] truncate rounded-md border border-brand-line bg-white px-2 text-xs text-brand-fg focus:border-brand-navy focus:outline-none"
          >
            <option value="all">Fornecedor: Todos ({suppliers.length})</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {catalogs.length > 0 && (
            <select
              value={catalogFilter}
              onChange={(e) => setCatalogFilter(e.target.value)}
              className="h-8 max-w-[260px] truncate rounded-md border border-brand-line bg-white px-2 text-xs text-brand-fg focus:border-brand-navy focus:outline-none"
            >
              <option value="all">Catálogo: Todos</option>
              {catalogs.map((c) => {
                const date = new Date(c.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                const label = `${c.supplier_name.slice(0, 30)} — ${c.source_name ?? "import"} (${date})`;
                return <option key={c.id} value={c.id}>{label}</option>;
              })}
            </select>
          )}

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-8 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Counts */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
          {filteredMatchCount} {filteredMatchCount === 1 ? "produto" : "produtos"} para identificar
        </span>
        <span className="rounded bg-purple-50 px-2.5 py-1 font-medium text-purple-800">
          {filteredExceptionCount} exceções
        </span>
        {hasFilters && (
          <span className="rounded bg-gray-100 px-2.5 py-1 text-gray-600">
            {filtered.length} de {items.length} total
          </span>
        )}
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-brand-line bg-white p-8 text-center text-sm text-brand-fg/50">
          {hasFilters ? "Nenhum item corresponde aos filtros aplicados." : "Nenhuma pendência. Todos os itens foram processados."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            if (item.kind === "matching") {
              const m = item as PendenciaMatchRow;
              const badge = REASON_BADGES[m.reason] ?? { label: m.reason, cls: "bg-gray-100 text-gray-700" };
              const isReview = m.match_status === "match_sugerido" || m.match_status === "revisao_manual";
              return (
                <div key={`m-${m.id}`} className="rounded-lg border border-brand-line bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-brand-fg">{m.title}</p>
                      <p className="text-xs text-brand-fg/60">
                        Fornecedor: {m.supplier_name}
                        {m.match_confidence != null && (
                          <span className="ml-2">Semelhança: {m.match_confidence}%</span>
                        )}
                        {m.master_product_name && (
                          <span className="ml-2">
                            Possível correspondência: {m.master_product_name}
                            {m.master_product_ean && ` (${m.master_product_ean})`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-brand-line pt-3">
                    <NoMasterActions
                      reviewMode={isReview}
                      item={m.item}
                    />
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-brand-fg/40 hover:text-brand-fg/60">
                      Ver detalhes técnicos
                    </summary>
                    <div className="mt-1 rounded bg-gray-50 p-2 text-[10px] text-brand-fg/50 space-y-0.5">
                      <p>Tipo: {m.match_status}</p>
                      {m.supplier_sku && <p>SKU: {m.supplier_sku}</p>}
                      {m.ean && <p>EAN: {m.ean}</p>}
                      {m.match_confidence != null && <p>Confidence score: {m.match_confidence}%</p>}
                      {m.item.master_product_id && <p>Master ID: {m.item.master_product_id}</p>}
                      <p>Item ID: {m.id}</p>
                    </div>
                  </details>
                </div>
              );
            }

            const ex = item as PendenciaExceptionRow;
            return (
              <div key={`e-${ex.id}`} className="rounded-lg border border-brand-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ExceptionBadge type={ex.type} severity={ex.severity} />
                      <span className="text-[10px] text-brand-fg/40">Exceção</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-brand-fg">{ex.title}</p>
                    {ex.supplier_name !== "—" && (
                      <p className="text-xs text-brand-fg/60">Fornecedor: {ex.supplier_name}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 border-t border-brand-line pt-3">
                  <ResolveExceptionForm exceptionId={ex.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
