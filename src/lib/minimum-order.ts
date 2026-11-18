/**
 * Minimum order options — 4 alternatives when a PO is below the supplier minimum.
 * Pure functions. NO automatic actions. Admin decides.
 */

import { nextOrderDay, addBusinessDays } from "./purchase-cycle.ts";

export interface MinOrderContext {
  poId: string;
  supplierId: string;
  cycleDateStr: string;
  totalCentavos: number;
  itemCount: number;
  minimumType: "valor" | "volume";
  minimumValue: number;
  freightType: string | null;
  freightFreeAbove: number | null;
  freightValue: number | null;
}

export interface SupplierTerms {
  diasPedido: number[];
  prazoEntregaCdDias: number;
  cutoffTime: string | null;
}

export interface AlternativeSupplier {
  supplierId: string;
  supplierName: string;
  totalCentavos: number;
  itemCount: number;
  minimumMet: boolean;
  prazoEntregaCdDias: number;
  diasPedido: number[];
}

export interface EligibleExtraItem {
  masterProductId: string;
  productName: string;
  unitCostCentavos: number;
  packagingQty: number;
  currentStock: number;
  maxSobraPercent: number;
}

export type MinOrderOptionType = "wait_next_cycle" | "move_supplier" | "pay_fee" | "complete_extra";

export interface MinOrderOption {
  type: MinOrderOptionType;
  available: boolean;
  label: string;
  extraCostCentavos: number;
  newDate: string | null;
  affectedOrderCount: number;
  details: Record<string, unknown>;
  reason?: string;
}

export function calculateMinimumOrderOptions(
  ctx: MinOrderContext,
  terms: SupplierTerms,
  alternativeSuppliers: AlternativeSupplier[],
  eligibleExtras: EligibleExtraItem[],
  affectedOrderCount: number,
  holidays: string[] = [],
): MinOrderOption[] {
  const cycleDate = new Date(ctx.cycleDateStr + "T12:00:00");
  const options: MinOrderOption[] = [];

  // 1. Wait next cycle
  const nextCycle = nextOrderDay(terms.diasPedido, cycleDate, true);
  const nextAvail = nextCycle ? addBusinessDays(nextCycle, terms.prazoEntregaCdDias, holidays) : null;
  options.push({
    type: "wait_next_cycle",
    available: !!nextCycle,
    label: "Esperar próximo ciclo",
    extraCostCentavos: 0,
    newDate: nextAvail ? nextAvail.toISOString().slice(0, 10) : null,
    affectedOrderCount,
    details: {
      nextCycleDate: nextCycle ? nextCycle.toISOString().slice(0, 10) : null,
      delayDays: nextCycle ? Math.round((nextCycle.getTime() - cycleDate.getTime()) / 86400000) : null,
    },
    reason: nextCycle ? undefined : "Sem dias de pedido configurados.",
  });

  // 2. Move to another supplier
  const eligible = alternativeSuppliers.filter((s) => s.minimumMet && s.itemCount > 0);
  if (eligible.length > 0) {
    const best = eligible.sort((a, b) => a.totalCentavos - b.totalCentavos)[0];
    const bestNext = nextOrderDay(best.diasPedido, cycleDate, false);
    const bestAvail = bestNext ? addBusinessDays(bestNext, best.prazoEntregaCdDias, holidays) : null;
    const costDiff = best.totalCentavos - ctx.totalCentavos;
    options.push({
      type: "move_supplier",
      available: true,
      label: "Mover para outro fornecedor",
      extraCostCentavos: costDiff > 0 ? costDiff : 0,
      newDate: bestAvail ? bestAvail.toISOString().slice(0, 10) : null,
      affectedOrderCount,
      details: {
        targetSupplierId: best.supplierId,
        targetSupplierName: best.supplierName,
        targetTotalCentavos: best.totalCentavos,
        costDifferenceCentavos: costDiff,
        eligibleCount: eligible.length,
      },
    });
  } else {
    options.push({
      type: "move_supplier",
      available: false,
      label: "Mover para outro fornecedor",
      extraCostCentavos: 0,
      newDate: null,
      affectedOrderCount,
      details: { eligibleCount: 0 },
      reason: "Nenhum fornecedor alternativo elegível com mínimo atingido.",
    });
  }

  // 3. Pay fee/freight
  const feeCentavos = ctx.freightValue != null ? Math.round(ctx.freightValue * 100) : 0;
  const currentAvail = addBusinessDays(cycleDate, terms.prazoEntregaCdDias, holidays);
  options.push({
    type: "pay_fee",
    available: feeCentavos > 0 || ctx.freightType === "fixo",
    label: "Pagar taxa/frete ao fornecedor",
    extraCostCentavos: feeCentavos,
    newDate: currentAvail.toISOString().slice(0, 10),
    affectedOrderCount,
    details: {
      freightType: ctx.freightType,
      freightCentavos: feeCentavos,
    },
    reason: feeCentavos <= 0 && ctx.freightType !== "fixo" ? "Sem valor de frete configurado." : undefined,
  });

  // 4. Complete with extra items
  const gap = computeGap(ctx);
  const feasible = eligibleExtras.filter((e) => e.unitCostCentavos > 0 && e.packagingQty > 0);
  if (feasible.length > 0 && gap > 0) {
    const suggestion = suggestExtras(feasible, gap, ctx.minimumType);
    options.push({
      type: "complete_extra",
      available: suggestion.totalCostCentavos > 0,
      label: "Completar com itens extras",
      extraCostCentavos: suggestion.totalCostCentavos,
      newDate: currentAvail.toISOString().slice(0, 10),
      affectedOrderCount,
      details: {
        gap,
        gapUnit: ctx.minimumType === "valor" ? "centavos" : "unidades",
        suggestedItems: suggestion.items,
        choiceIsManual: true,
      },
    });
  } else {
    options.push({
      type: "complete_extra",
      available: false,
      label: "Completar com itens extras",
      extraCostCentavos: 0,
      newDate: null,
      affectedOrderCount,
      details: { gap, eligibleCount: feasible.length },
      reason: feasible.length === 0
        ? "Sem itens extras elegíveis do fornecedor."
        : "Mínimo já atingido.",
    });
  }

  return options;
}

function computeGap(ctx: MinOrderContext): number {
  if (ctx.minimumType === "valor") {
    return Math.max(0, Math.round(ctx.minimumValue * 100) - ctx.totalCentavos);
  }
  return Math.max(0, ctx.minimumValue - ctx.itemCount);
}

interface ExtraSuggestion {
  items: Array<{ masterProductId: string; productName: string; qty: number; costCentavos: number }>;
  totalCostCentavos: number;
}

function suggestExtras(
  extras: EligibleExtraItem[],
  gap: number,
  minimumType: "valor" | "volume",
): ExtraSuggestion {
  const sorted = [...extras].sort((a, b) => b.unitCostCentavos - a.unitCostCentavos);
  const items: ExtraSuggestion["items"] = [];
  let remaining = gap;

  for (const e of sorted) {
    if (remaining <= 0) break;
    const contribution = minimumType === "valor" ? e.unitCostCentavos * e.packagingQty : e.packagingQty;
    if (contribution <= 0) continue;
    const qty = e.packagingQty;
    items.push({
      masterProductId: e.masterProductId,
      productName: e.productName,
      qty,
      costCentavos: e.unitCostCentavos * qty,
    });
    remaining -= contribution;
  }

  return {
    items,
    totalCostCentavos: items.reduce((s, i) => s + i.costCentavos, 0),
  };
}
