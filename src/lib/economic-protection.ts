export interface CreditMovement {
  movement_type: string;
  amount_centavos: number;
}

export interface FreightAllocationInput {
  order_id: string;
  order_cost_centavos: number;
}

export interface FreightAllocationResult {
  order_id: string;
  freight_allocated_centavos: number;
}

export interface ProjectResultInput {
  revenueCentavos: number;
  discountCentavos: number;
  creditDiscountCentavos: number;
  supplierCostCentavos: number;
  supplierFreightCentavos: number;
}

export const CREDIT_TYPES: Record<string, number> = {
  credit_generated: 1,
  credit_reserved: -1,
  credit_used: 0,
  credit_released: 1,
  credit_adjusted: 1,
  credit_reversed: 1,
};

export function computeCreditBalance(movements: CreditMovement[]): number {
  let balance = 0;
  for (const m of movements) {
    const effect = CREDIT_TYPES[m.movement_type];
    if (effect === undefined) continue;
    if (m.movement_type === "credit_adjusted") {
      balance += m.amount_centavos;
    } else {
      balance += effect * m.amount_centavos;
    }
  }
  return balance;
}

export function proratePOFreight(
  orders: FreightAllocationInput[],
  freightCentavos: number,
): FreightAllocationResult[] {
  if (orders.length === 0 || freightCentavos <= 0) return [];

  const totalCost = orders.reduce((s, o) => s + o.order_cost_centavos, 0);
  if (totalCost <= 0) return [];

  const allocated: FreightAllocationResult[] = orders.map((o) => ({
    order_id: o.order_id,
    freight_allocated_centavos: Math.floor(
      (o.order_cost_centavos / totalCost) * freightCentavos,
    ),
  }));

  let distributed = allocated.reduce((s, a) => s + a.freight_allocated_centavos, 0);
  let remainder = freightCentavos - distributed;

  if (remainder > 0) {
    const remainders = orders.map((o, i) => ({
      index: i,
      frac:
        (o.order_cost_centavos / totalCost) * freightCentavos -
        Math.floor((o.order_cost_centavos / totalCost) * freightCentavos),
      cost: o.order_cost_centavos,
    }));
    remainders.sort((a, b) => b.frac - a.frac || b.cost - a.cost);
    for (let i = 0; i < remainder; i++) {
      allocated[remainders[i].index].freight_allocated_centavos += 1;
    }
  }

  return allocated;
}

export function validateFreightClosure(
  allocations: FreightAllocationResult[],
  freightCentavos: number,
): boolean {
  const total = allocations.reduce((s, a) => s + a.freight_allocated_centavos, 0);
  return total === freightCentavos;
}

export function projectResult(input: ProjectResultInput): {
  projected_result_centavos: number;
} {
  const projected_result_centavos =
    input.revenueCentavos -
    input.supplierCostCentavos -
    input.supplierFreightCentavos -
    input.creditDiscountCentavos;
  return { projected_result_centavos };
}

export function isResultAboveMinimum(
  resultCentavos: number,
  minResultCentavos: number,
): boolean {
  return resultCentavos >= minResultCentavos;
}

export function calculateSavings(
  expectedCostCentavos: number,
  confirmedCostCentavos: number,
  qty: number,
): number {
  if (confirmedCostCentavos >= expectedCostCentavos) return 0;
  return (expectedCostCentavos - confirmedCostCentavos) * qty;
}
