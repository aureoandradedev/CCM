import type { Product } from "@/types/catalog";
import { calculateBoxPrice } from "@/lib/purchase-cycle";
import { formatBRL } from "@/lib/utils/format";
import { Package, CalendarClock } from "lucide-react";

/**
 * Exibe informação de modo de venda e disponibilidade (R3, R4.2).
 *
 * - unidade_e_caixa: mostra opção de caixa com desconto
 * - embalagem_fechada: mostra que só vende embalagem fechada
 * - expected_availability_date: mostra data estimada de disponibilidade
 */
export function SaleModeInfo({ product }: { product: Product }) {
  const {
    saleMode,
    qtdPorEmbalagem,
    unidadeCompra,
    packageDiscountPct,
    retailPrice,
    expectedAvailabilityDate,
  } = product;

  const showBoxOption =
    saleMode === "unidade_e_caixa" &&
    qtdPorEmbalagem &&
    qtdPorEmbalagem > 1 &&
    packageDiscountPct != null &&
    packageDiscountPct > 0;

  const showPackOnly =
    saleMode === "embalagem_fechada" &&
    qtdPorEmbalagem &&
    qtdPorEmbalagem > 1;

  if (!showBoxOption && !showPackOnly && !expectedAvailabilityDate) return null;

  return (
    <div className="space-y-2">
      {showBoxOption && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-green/20 bg-brand-green-soft p-3 text-sm">
          <Package className="size-5 shrink-0 text-brand-green" />
          <div>
            <p className="font-semibold text-brand-ink">
              {unidadeCompra === "caixa" ? "Caixa" : unidadeCompra === "fardo" ? "Fardo" : "Embalagem"} com{" "}
              {qtdPorEmbalagem} un. —{" "}
              <span className="text-brand-green">
                {formatBRL(calculateBoxPrice(retailPrice, qtdPorEmbalagem!, packageDiscountPct!))}
              </span>{" "}
              <span className="text-brand-ink-soft">({packageDiscountPct}% off)</span>
            </p>
          </div>
        </div>
      )}

      {showPackOnly && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-card p-3 text-sm">
          <Package className="size-5 shrink-0 text-brand-ink-soft" />
          <p className="text-brand-ink-soft">
            Vendido somente em{" "}
            {unidadeCompra === "caixa" ? "caixa" : unidadeCompra === "fardo" ? "fardo" : "embalagem"} com{" "}
            {qtdPorEmbalagem} un.
          </p>
        </div>
      )}

      {expectedAvailabilityDate && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-card p-3 text-sm">
          <CalendarClock className="size-5 shrink-0 text-brand-navy" />
          <p className="text-brand-ink">
            Disponível no CD a partir de{" "}
            <strong>
              {new Date(expectedAvailabilityDate + "T12:00:00").toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </strong>
          </p>
        </div>
      )}
    </div>
  );
}
