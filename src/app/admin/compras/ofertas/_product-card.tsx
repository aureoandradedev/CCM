"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";

import { selectOffer, publishProduct } from "../actions";

interface OfferRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  cost_centavos: number;
  stock: number | null;
  lead_time_days: number;
  position: number;
  score_total: number;
  reasons: string[];
  flags: string[];
  is_recommended: boolean;
  pedido_minimo: number | null;
  frete_tipo: string | null;
  frete_gratis_acima: number | null;
  frete_valor: number | null;
}

interface ProductCardProps {
  masterProductId: string;
  name: string;
  ean: string | null;
  brandSlug: string | null;
  offers: OfferRow[];
  selectedOfferId: string | null;
  recommendedOfferId: string | null;
  ambiguous: boolean;
  sourcingMode?: "auto" | "manual" | null;
}

function formatCentavos(v: number) {
  return `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
}

function formatFrete(o: OfferRow) {
  if (!o.frete_tipo) return "—";
  if (o.frete_tipo === "gratis_acima" && o.frete_gratis_acima) {
    return `Grátis > ${formatCentavos(o.frete_gratis_acima)}`;
  }
  if (o.frete_tipo === "fixo" && (!o.frete_valor || o.frete_valor === 0)) return "Grátis";
  if (o.frete_valor) return `Fixo ${formatCentavos(o.frete_valor)}`;
  return o.frete_tipo;
}

function formatPedidoMinimo(v: number | null) {
  if (v == null) return "—";
  return formatCentavos(v);
}

export function ProductCard({
  masterProductId,
  name,
  ean,
  brandSlug,
  offers,
  selectedOfferId,
  recommendedOfferId,
  ambiguous,
  sourcingMode,
}: ProductCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectState, selectAction, selectPending] = useActionState(selectOffer, {});
  const recommended = offers.find((o) => o.is_recommended);
  const hasSelection = selectedOfferId != null;

  return (
    <div className="rounded-lg border border-brand-line bg-white">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-brand-bg/30"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-brand-fg">{name}</span>
            {ean && <span className="text-[10px] text-brand-fg/40">{ean}</span>}
            {brandSlug && <span className="text-[10px] text-brand-fg/40">({brandSlug})</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs">
            <span className="text-brand-fg/60">{offers.length} fornecedor(es)</span>
            {recommended && !ambiguous && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                Recomendado pelo ranking atual: {recommended.supplier_name}
              </span>
            )}
            {ambiguous && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Ranking ambíguo — decisão manual
              </span>
            )}
            {hasSelection && sourcingMode === "auto" && (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                Automático
              </span>
            )}
            {hasSelection && sourcingMode !== "auto" && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">
                Selecionado
              </span>
            )}
          </div>
        </div>
        <span className="ml-2 text-brand-fg/40">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-brand-line px-4 py-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-brand-line text-[10px] font-bold uppercase text-brand-fg/50">
                  <th className="px-2 py-1.5">Fornecedor</th>
                  <th className="px-2 py-1.5 text-right">Custo</th>
                  <th className="px-2 py-1.5 text-right">Estoque</th>
                  <th className="px-2 py-1.5 text-right">Prazo</th>
                  <th className="px-2 py-1.5 text-right">Frete *</th>
                  <th className="px-2 py-1.5 text-right">Ped. mín. *</th>
                  <th className="px-2 py-1.5 text-right">Score</th>
                  <th className="px-2 py-1.5">Ação</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const isSelected = selectedOfferId === o.id;
                  const isRec = o.is_recommended;
                  return (
                    <tr
                      key={o.id}
                      className={`border-b border-brand-line last:border-0 ${isRec ? "bg-green-50" : ""} ${isSelected ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-2 py-2 font-medium">
                        {o.supplier_name}
                        {isRec && <span className="ml-1 text-green-700">★</span>}
                        {isSelected && <span className="ml-1 text-blue-700">✓</span>}
                      </td>
                      <td className="px-2 py-2 text-right font-medium">{formatCentavos(o.cost_centavos)}</td>
                      <td className="px-2 py-2 text-right">
                        {o.stock != null ? `${o.stock} un` : "—"}
                        {o.flags.includes("low_stock") && <span className="ml-1 text-amber-600">!</span>}
                        {o.flags.includes("out_of_stock") && <span className="ml-1 text-red-600">✕</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{o.lead_time_days}d</td>
                      <td className="px-2 py-2 text-right text-brand-fg/60">{formatFrete(o)}</td>
                      <td className="px-2 py-2 text-right text-brand-fg/60">{formatPedidoMinimo(o.pedido_minimo)}</td>
                      <td className="px-2 py-2 text-right">{o.score_total.toFixed(1)}</td>
                      <td className="px-2 py-2">
                        {!isSelected && (
                          <form action={selectAction} className="inline">
                            <input type="hidden" name="masterProductId" value={masterProductId} />
                            <input type="hidden" name="offerId" value={o.id} />
                            <input type="hidden" name="note" value={isRec ? "Confirmado recomendado" : "manual_override"} />
                            <button
                              disabled={selectPending}
                              className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
                                hasSelection
                                  ? "border border-brand-line text-brand-fg/70 hover:bg-brand-bg/40"
                                  : isRec
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "bg-brand-navy text-white hover:opacity-90"
                              }`}
                            >
                              {selectPending ? "…" : hasSelection ? "Alterar" : isRec ? "Confirmar" : "Selecionar"}
                            </button>
                          </form>
                        )}
                        {isSelected && (
                          <span className="text-[10px] font-medium text-blue-700">Selecionado</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[10px] text-brand-fg/40">
            * Frete e pedido mínimo são informativos — ainda não entram no ranking.
          </p>

          {offers.some((o) => o.reasons.length > 0 && o.is_recommended) && (
            <p className="mt-1 text-[10px] text-green-700">
              Recomendado pelo ranking atual:{" "}
              {recommended?.reasons.join(", ")}
            </p>
          )}

          {selectState?.error && <p className="mt-2 text-xs text-red-600">{selectState.error}</p>}
          {selectState?.ok && <p className="mt-2 text-xs text-green-600">{selectState.ok}</p>}

          <div className="mt-3 flex items-center gap-3 border-t border-brand-line pt-3">
            {hasSelection && (
              <Link
                href={`/admin/compras/ofertas/${masterProductId}`}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
              >
                Publicar
              </Link>
            )}
            <Link
              href={`/admin/compras/ofertas/${masterProductId}`}
              className="text-xs text-brand-navy hover:underline"
            >
              Ver detalhes
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
