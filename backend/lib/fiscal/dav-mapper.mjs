/**
 * Builds the Uniplus DAV payload from a CCM order.
 * Values in centavos internally; converted to reais (2 decimal) for the payload.
 * Validates subtotal - desconto + frete = total before building.
 */
import { createHash } from "node:crypto";
import { config } from "../config.mjs";

export class FiscalValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FiscalValidationError";
    this.details = details;
  }
}

function centavosToReais(centavos) {
  return Number((centavos / 100).toFixed(2));
}

function sanitizeForLog(obj) {
  const clone = { ...obj };
  delete clone.token;
  delete clone.authorization;
  delete clone.senha;
  delete clone.password;
  return clone;
}

export function generateCodigoEcommerce(orderCode, shipmentId = null) {
  const base = shipmentId ? `${orderCode}-${shipmentId}` : orderCode;
  return `CCM-${base}`;
}

export function hashPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export function validateOrderValues(order, items) {
  const errors = [];

  const subtotal = Number(order.subtotal_centavos ?? 0);
  const discount = Number(order.discount_centavos ?? 0);
  const freight  = Number(order.freight_centavos ?? 0);
  const total    = Number(order.total_centavos ?? 0);

  if (!Number.isFinite(subtotal) || subtotal < 0) errors.push("subtotal_centavos inválido");
  if (!Number.isFinite(discount) || discount < 0) errors.push("discount_centavos inválido");
  if (!Number.isFinite(freight)  || freight < 0)  errors.push("freight_centavos inválido");
  if (!Number.isFinite(total)    || total <= 0)    errors.push("total_centavos inválido");

  const expected = subtotal - discount + freight;
  if (expected !== total) {
    errors.push(`Reconciliação falhou: subtotal(${subtotal}) - desconto(${discount}) + frete(${freight}) = ${expected}, esperado total=${total}`);
  }

  if (Array.isArray(items) && items.length > 0) {
    const itemSum = items.reduce((s, it) => s + (Number(it.line_centavos) || 0), 0);
    if (itemSum !== subtotal) {
      errors.push(`Soma dos itens(${itemSum}) ≠ subtotal(${subtotal})`);
    }
  }

  if (errors.length) {
    throw new FiscalValidationError("Valores do pedido inconsistentes para emissão fiscal", { errors });
  }

  return { subtotal, discount, freight, total };
}

export function isEligibleForFiscal(order) {
  if (!order) return { eligible: false, reason: "Pedido não encontrado" };
  if (!order.id) return { eligible: false, reason: "Pedido sem ID" };
  if (order.order_status === "cancelado") return { eligible: false, reason: "Pedido cancelado" };
  if (order.payment_status !== "pago") return { eligible: false, reason: "Pagamento não confirmado" };
  if (!order.customer?.document) return { eligible: false, reason: "Documento do cliente ausente" };

  const total = Number(order.total_centavos ?? 0);
  if (total <= 0) return { eligible: false, reason: "Total zero ou negativo" };

  return { eligible: true, reason: null };
}

export function buildUniplusDavPayload(order, items, shipment = null) {
  const { subtotal, discount, freight, total } = validateOrderValues(order, items);

  const doc = String(order.customer?.document ?? "").replace(/\D/g, "");
  if (!doc) throw new FiscalValidationError("Documento do cliente ausente");

  const isPJ = doc.length === 14;
  const codigoEcommerce = generateCodigoEcommerce(
    order.code,
    shipment?.id ?? null,
  );

  const payload = {
    codigoECommerce: codigoEcommerce,
    filial: config.uniplusFilial,
    vendedor: config.uniplusVendedor,
    condicaoFinanceira: config.uniplusCondicaoFinanceira,
    tipoDocumento: config.uniplusTipoDocumento,

    cliente: {
      documento: doc,
      tipoPessoa: isPJ ? "J" : "F",
      nome: order.customer.name || "",
      email: order.customer.email || "",
      telefone: order.customer.phone || "",
      ...(isPJ ? { razaoSocial: order.customer.razao_social || order.customer.name || "" } : {}),
    },

    endereco: order.address
      ? {
          cep: order.address.cep || "",
          logradouro: order.address.street || "",
          numero: order.address.number || "",
          complemento: order.address.complement || "",
          bairro: order.address.district || "",
          cidade: order.address.city || "",
          uf: order.address.state || "",
        }
      : null,

    itens: items.map((it, idx) => ({
      sequencia: idx + 1,
      produtoId: it.product_id,
      sku: it.sku || "",
      descricao: it.name || "",
      unidade: it.unit || "UN",
      quantidade: it.qty,
      valorUnitario: centavosToReais(it.unit_price_centavos),
      valorTotal: centavosToReais(it.line_centavos),
    })),

    valores: {
      subtotal: centavosToReais(subtotal),
      desconto: centavosToReais(discount),
      frete: centavosToReais(freight),
      total: centavosToReais(total),
    },
  };

  return { payload, codigoEcommerce, payloadHash: hashPayload(payload) };
}
