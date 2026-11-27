import type { FulfillmentStatus, OrderItemRow } from "./orders";

const CUSTOMER_DISPLAY: Record<FulfillmentStatus, string> = {
  aguardando_fornecedor: "Verificando disponibilidade",
  atendido: "Disponível",
  complemento_pendente: "Buscando com fornecedor",
  removido: "Removido do pedido",
};

const ADMIN_DISPLAY: Record<FulfillmentStatus, { label: string; tone: string }> = {
  aguardando_fornecedor: { label: "Aguardando fornecedor", tone: "orange" },
  atendido: { label: "Atendido", tone: "green" },
  complemento_pendente: { label: "Complemento pendente", tone: "yellow" },
  removido: { label: "Removido", tone: "red" },
};

export function getCustomerDisplayStatus(item: Pick<OrderItemRow, "fulfillment_status" | "removal_reason">): string | null {
  if (item.removal_reason) return CUSTOMER_DISPLAY.removido;
  if (!item.fulfillment_status) return null;
  return CUSTOMER_DISPLAY[item.fulfillment_status] ?? null;
}

export function getAdminDisplayStatus(item: Pick<OrderItemRow, "fulfillment_status" | "removal_reason">): { label: string; tone: string } | null {
  if (item.removal_reason) return ADMIN_DISPLAY.removido;
  if (!item.fulfillment_status) return null;
  return ADMIN_DISPLAY[item.fulfillment_status] ?? null;
}

export function canCreateComplement(item: Pick<OrderItemRow, "residual_qty" | "removal_reason" | "qty">): boolean {
  if (item.removal_reason) return false;
  const residual = item.residual_qty ?? 0;
  return residual > 0 && item.qty > 0;
}
