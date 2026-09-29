/** Rótulos e helpers de pedido compartilhados entre conta do cliente e admin. */

export const ORDER_STATUS = {
  "aguardando-pagamento": { label: "Aguardando pagamento", tone: "yellow" },
  "em-separacao": { label: "Em separação", tone: "blue" },
  separados: { label: "Separado / em entrega", tone: "navy" },
  "pagamento-pendente": { label: "Pagamento pendente", tone: "orange" },
  pagos: { label: "Finalizado", tone: "green" },
  arquivados: { label: "Arquivado", tone: "slate" },
  cancelado: { label: "Cancelado", tone: "red" },
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

export const PAYMENT_STATUS = {
  pendente: { label: "Pendente", tone: "yellow" },
  pago: { label: "Pago", tone: "green" },
  negado: { label: "Negado", tone: "red" },
  estornado: { label: "Estornado", tone: "slate" },
} as const;

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  "cartao-pendente": "Cartão (aguardando)",
  "cartao-credito": "Cartão de crédito",
  "cartao-debito": "Cartão de débito",
  "na-entrega": "Na entrega",
  boleto: "Boleto",
  faturado: "Faturado",
};

export const TONE_CLASS: Record<string, string> = {
  yellow: "bg-brand-yellow-soft text-brand-navy",
  blue: "bg-brand-blue/10 text-brand-blue",
  navy: "bg-brand-navy text-white",
  orange: "bg-brand-orange-soft text-brand-orange",
  green: "bg-brand-green-soft text-brand-green",
  slate: "bg-muted text-brand-ink-soft",
  red: "bg-brand-red/10 text-brand-red",
};

export function statusLabel(s: string): { label: string; tone: string } {
  return (ORDER_STATUS as Record<string, { label: string; tone: string }>)[s] ?? { label: s, tone: "slate" };
}
export function paymentLabel(s: string): { label: string; tone: string } {
  return (PAYMENT_STATUS as Record<string, { label: string; tone: string }>)[s] ?? { label: s, tone: "slate" };
}
export function methodLabel(m: string): string {
  return PAYMENT_METHOD_LABEL[m] ?? m;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export interface OrderRow {
  id: string;
  code: string;
  created_at: string;
  order_status: string;
  payment_status: string;
  payment_method: string;
  total_centavos: number;
  subtotal_centavos: number;
  discount_centavos: number;
  freight_centavos: number;
  wholesale_savings_centavos: number;
  items_count: number;
  delivery_method: string;
  customer: { name: string; document: string; phone: string; email: string };
  address: { cep: string; street: string; number: string; complement?: string | null; district: string; city: string; state: string; reference?: string | null } | null;
  pricing_version: number;
  paid_at: string | null;
  notes: string | null;
  cash_pending?: boolean;
  refund_status?: string | null;
  revenue_excluded?: boolean;
  revenue_excluded_reason?: string | null;
  payment_provider?: string | null;
  cielo_payment_id?: string | null;
  pix_expires_at?: string | null;
  supplier_ids?: string[];
  origin?: string;
}

export interface OrderItemRow {
  id: string;
  product_id: string | null;
  supplier_id: string | null;
  name: string;
  sku: string | null;
  image: string | null;
  unit: string;
  qty: number;
  price_tier: string;
  unit_price_centavos: number;
  retail_price_centavos: number;
  line_centavos: number;
}

export const ORDER_COLUMNS =
  "id, code, created_at, order_status, payment_status, payment_method, total_centavos, subtotal_centavos, discount_centavos, freight_centavos, wholesale_savings_centavos, items_count, delivery_method, customer, address, pricing_version, paid_at, notes, cash_pending, refund_status, revenue_excluded, revenue_excluded_reason, payment_provider, cielo_payment_id, pix_expires_at, supplier_ids, origin";
