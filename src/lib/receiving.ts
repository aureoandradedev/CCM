/**
 * Recebimento no CD — funções puras.
 */

export interface ReceivingItemInput {
  purchaseOrderItemId: string;
  masterProductId: string;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  damagedQty: number;
}

export interface ReceivingValidation {
  valid: boolean;
  errors: string[];
  shortage: number;
  excess: number;
}

export interface ReceivingSummary {
  totalExpected: number;
  totalReceived: number;
  totalAccepted: number;
  totalDamaged: number;
  itemCount: number;
  divergenceRate: number;
}

export function validateReceivingItem(item: ReceivingItemInput): ReceivingValidation {
  const errors: string[] = [];

  if (item.expectedQty <= 0) errors.push("expectedQty must be positive");
  if (item.receivedQty < 0) errors.push("receivedQty cannot be negative");
  if (item.acceptedQty < 0) errors.push("acceptedQty cannot be negative");
  if (item.damagedQty < 0) errors.push("damagedQty cannot be negative");
  if (item.acceptedQty + item.damagedQty > item.receivedQty) {
    errors.push("accepted + damaged cannot exceed received");
  }

  const shortage = Math.max(0, item.expectedQty - item.receivedQty);
  const excess = Math.max(0, item.receivedQty - item.expectedQty);

  return { valid: errors.length === 0, errors, shortage, excess };
}

export function summarizeReceiving(items: ReceivingItemInput[]): ReceivingSummary {
  let totalExpected = 0;
  let totalReceived = 0;
  let totalAccepted = 0;
  let totalDamaged = 0;

  for (const item of items) {
    totalExpected += item.expectedQty;
    totalReceived += item.receivedQty;
    totalAccepted += item.acceptedQty;
    totalDamaged += item.damagedQty;
  }

  const divergenceRate =
    totalExpected === 0
      ? 0
      : Math.abs(totalExpected - totalReceived) / totalExpected;

  return {
    totalExpected,
    totalReceived,
    totalAccepted,
    totalDamaged,
    itemCount: items.length,
    divergenceRate,
  };
}
