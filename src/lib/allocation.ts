/**
 * Alocação de estoque recebido — funções puras.
 *
 * Prioridade:
 *   1. promised_to mais antigo (pedidos com prazo mais apertado)
 *   2. maximizar pedidos completos (não dividir estoque em parciais)
 *   3. created_at mais antigo (pedido mais antigo primeiro)
 *
 * allocateStock retorna um PLANO — NÃO persiste nada.
 * O admin revisa e confirma via confirmAllocation.
 */

export interface ReceivedProduct {
  masterProductId: string;
  acceptedQty: number;
}

export interface PendingShipmentItem {
  orderItemId: string;
  shipmentId: string;
  orderId: string;
  masterProductId: string;
  quantity: number;
  promisedTo: string | null;
  createdAt: string | null;
}

export interface AllocationEntry {
  orderItemId: string;
  shipmentId: string;
  orderId: string;
  masterProductId: string;
  allocatedQty: number;
}

export interface AllocationPlan {
  allocations: AllocationEntry[];
  fullyAllocatedShipments: string[];
  partiallyAllocatedShipments: string[];
  unallocatedShipments: string[];
  remainingStock: Map<string, number>;
}

export interface ShortageInfo {
  masterProductId: string;
  shortageQty: number;
  affectedShipmentIds: string[];
  affectedOrderIds: string[];
}

interface ShipmentGroup {
  shipmentId: string;
  orderId: string;
  promisedTo: string | null;
  createdAt: string | null;
  items: { orderItemId: string; masterProductId: string; quantity: number }[];
}

function groupByShipment(items: PendingShipmentItem[]): ShipmentGroup[] {
  const map = new Map<string, ShipmentGroup>();
  for (const item of items) {
    let group = map.get(item.shipmentId);
    if (!group) {
      group = {
        shipmentId: item.shipmentId,
        orderId: item.orderId,
        promisedTo: item.promisedTo,
        createdAt: item.createdAt,
        items: [],
      };
      map.set(item.shipmentId, group);
    }
    group.items.push({
      orderItemId: item.orderItemId,
      masterProductId: item.masterProductId,
      quantity: item.quantity,
    });
  }
  return Array.from(map.values());
}

function sortShipments(groups: ShipmentGroup[]): ShipmentGroup[] {
  return groups.slice().sort((a, b) => {
    const aDate = a.promisedTo ?? "9999-12-31";
    const bDate = b.promisedTo ?? "9999-12-31";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;

    const aCreated = a.createdAt ?? "9999-12-31T23:59:59Z";
    const bCreated = b.createdAt ?? "9999-12-31T23:59:59Z";
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

    return 0;
  });
}

function canFulfillCompletely(
  group: ShipmentGroup,
  stock: Map<string, number>,
): boolean {
  for (const item of group.items) {
    const available = stock.get(item.masterProductId) ?? 0;
    if (available < item.quantity) return false;
  }
  return true;
}

export function allocateStock(
  received: ReceivedProduct[],
  pending: PendingShipmentItem[],
): AllocationPlan {
  const stock = new Map<string, number>();
  for (const r of received) {
    stock.set(r.masterProductId, (stock.get(r.masterProductId) ?? 0) + r.acceptedQty);
  }

  const groups = sortShipments(groupByShipment(pending));
  const allocations: AllocationEntry[] = [];
  const fullyAllocated: string[] = [];
  const partiallyAllocated: string[] = [];
  const unallocated: string[] = [];

  // Pass 1: allocate shipments that can be fulfilled completely (maximize complete orders)
  const deferred: ShipmentGroup[] = [];
  for (const group of groups) {
    if (canFulfillCompletely(group, stock)) {
      for (const item of group.items) {
        const current = stock.get(item.masterProductId)!;
        stock.set(item.masterProductId, current - item.quantity);
        allocations.push({
          orderItemId: item.orderItemId,
          shipmentId: group.shipmentId,
          orderId: group.orderId,
          masterProductId: item.masterProductId,
          allocatedQty: item.quantity,
        });
      }
      fullyAllocated.push(group.shipmentId);
    } else {
      deferred.push(group);
    }
  }

  // Pass 2: partially allocate remaining shipments with leftover stock
  for (const group of deferred) {
    let anyAllocated = false;
    for (const item of group.items) {
      const available = stock.get(item.masterProductId) ?? 0;
      if (available <= 0) continue;
      const qty = Math.min(available, item.quantity);
      stock.set(item.masterProductId, available - qty);
      allocations.push({
        orderItemId: item.orderItemId,
        shipmentId: group.shipmentId,
        orderId: group.orderId,
        masterProductId: item.masterProductId,
        allocatedQty: qty,
      });
      anyAllocated = true;
    }
    if (anyAllocated) {
      partiallyAllocated.push(group.shipmentId);
    } else {
      unallocated.push(group.shipmentId);
    }
  }

  return {
    allocations,
    fullyAllocatedShipments: fullyAllocated,
    partiallyAllocatedShipments: partiallyAllocated,
    unallocatedShipments: unallocated,
    remainingStock: stock,
  };
}

export function analyzeShortageImpact(
  shortages: { masterProductId: string; shortageQty: number }[],
  pending: PendingShipmentItem[],
): ShortageInfo[] {
  return shortages
    .filter((s) => s.shortageQty > 0)
    .map((s) => {
      const affected = pending.filter(
        (p) => p.masterProductId === s.masterProductId,
      );
      return {
        masterProductId: s.masterProductId,
        shortageQty: s.shortageQty,
        affectedShipmentIds: [...new Set(affected.map((a) => a.shipmentId))],
        affectedOrderIds: [...new Set(affected.map((a) => a.orderId))],
      };
    });
}
