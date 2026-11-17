/**
 * Criação de pedido SERVER-SIDE (porte do handlerCriarPedido do mercado para o
 * modelo do CCM: varejo x atacado por quantidade, desconto Pix, frete simples).
 *
 * O cliente manda só ids + quantidades + dados de contato/entrega. Preços,
 * totais, frete, status e código nascem aqui. Idempotência por creation_key.
 */
import { createHmac } from "node:crypto";

import { config } from "./config.mjs";
import { db, registrarEvento } from "./supabase.mjs";
import { atacadoAtivo, calcularFrete, descontoPixCentavos, metodoEhPix, metodoOnline, precoUnitarioCentavos, centavos } from "./precos.mjs";
import { computeShipments } from "./delivery-promise.mjs";

export class ErroPedido extends Error {
  constructor(status, erro, extra = {}) {
    super(erro);
    this.status = status;
    this.extra = extra;
  }
}

const METODOS = new Set(["pix", "cartao-pendente", "cartao-credito", "cartao-debito", "na-entrega", "boleto", "faturado"]);

/* ---------------- validações reaproveitadas do mercado ---------------- */
const digitos = (v) => String(v ?? "").replace(/\D+/g, "");

export function validarCPF(raw) {
  const c = digitos(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base) => {
    let s = 0;
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (base.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}
export function validarCNPJ(raw) {
  const c = digitos(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(c[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/* ---------------- rate limit por cliente / documento (memória) ------------- */
const janelas = new Map();
setInterval(() => {
  const agora = Date.now();
  for (const [k, w] of janelas) {
    if (w.every((t) => agora - t >= config.pedidoRateWindowMs)) janelas.delete(k);
  }
}, 5 * 60_000);
function checarRateLimit(customerHash) {
  const agora = Date.now();
  const w = janelas.get(customerHash) || [];
  const recentes = w.filter((t) => agora - t < config.pedidoRateWindowMs);
  if (recentes.length >= config.pedidoRateMax) throw new ErroPedido(429, "Muitos pedidos em pouco tempo. Aguarde um minuto.");
  recentes.push(agora);
  janelas.set(customerHash, recentes);
}

function customerHashDe(document) {
  if (!config.pedidoHmacSecret || config.pedidoHmacSecret.length < 32) {
    console.error("[pedido] PEDIDO_HMAC_SECRET não configurado (mínimo 32 caracteres).");
    throw new ErroPedido(503, "Serviço temporariamente indisponível.");
  }
  return "c_" + createHmac("sha256", config.pedidoHmacSecret).update(digitos(document)).digest("hex").slice(0, 32);
}

function cartHash(itens) {
  const base = itens
    .map((i) => `${i.productId}x${i.qty}`)
    .sort()
    .join("|");
  return createHmac("sha256", "cart").update(base).digest("hex").slice(0, 16);
}

async function lerSettings() {
  const { data } = await db().from("site_settings").select("key, value").in("key", ["frete", "descontos", "entrega_bloqueio"]);
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value || {}]));
  return { frete: map.frete || {}, descontos: map.descontos || {}, bloqueio: map.entrega_bloqueio || {} };
}

/* ---------------- montagem canônica dos itens ---------------- */
export async function montarItens(itensBrutos) {
  if (!Array.isArray(itensBrutos) || !itensBrutos.length) throw new ErroPedido(400, "Carrinho vazio.");
  if (itensBrutos.length > 200) throw new ErroPedido(400, "Carrinho com itens demais.");

  const agrupado = new Map();
  for (const it of itensBrutos) {
    const id = String(it?.productId || "").trim();
    const qty = Math.floor(Number(it?.qty));
    if (!id || !Number.isInteger(qty) || qty < 1) throw new ErroPedido(400, "Item inválido no carrinho.");
    agrupado.set(id, (agrupado.get(id) || 0) + qty);
  }

  const ids = [...agrupado.keys()];
  const { data: produtos, error } = await db()
    .from("products")
    .select("id, sku, name, unit, images, retail_price, wholesale_price, wholesale_min_qty, supplier_id, category_slug, stock, max_per_order, max_per_order_enabled, active, cost_centavos, winning_offer_id, master_product_id, expected_availability_date")
    .in("id", ids);
  if (error) {
    console.error("[pedido] Falha ao ler produtos:", error.message);
    throw new ErroPedido(500, "Falha ao carregar os produtos. Tente novamente.");
  }
  const porId = new Map((produtos || []).map((p) => [p.id, p]));

  const rejeitados = [];
  const itens = [];
  for (const [id, qty] of agrupado) {
    const p = porId.get(id);
    if (!p || !p.active) {
      rejeitados.push({ productId: id, erro: "indisponivel" });
      continue;
    }
    if (p.stock !== null && p.stock !== undefined && p.stock <= 0) {
      rejeitados.push({ productId: id, erro: "esgotado", nome: p.name });
      continue;
    }
    const teto = p.max_per_order_enabled && p.max_per_order ? Number(p.max_per_order) : config.pedidoMaxQtdUn;
    if (qty > teto) {
      rejeitados.push({ productId: id, erro: "acima-do-limite", nome: p.name, limite: teto });
      continue;
    }
    if (p.stock !== null && p.stock !== undefined && qty > p.stock) {
      rejeitados.push({ productId: id, erro: "sem-estoque", nome: p.name, limite: p.stock });
      continue;
    }
    const unit = precoUnitarioCentavos(p, qty);
    const retail = centavos(p.retail_price);
    itens.push({
      product_id: p.id,
      supplier_id: p.supplier_id,
      category_slug: p.category_slug,
      name: p.name,
      sku: p.sku,
      image: p.images?.[0] || null,
      unit: p.unit,
      qty,
      price_tier: atacadoAtivo(p, qty) ? "wholesale" : "retail",
      unit_price_centavos: unit,
      retail_price_centavos: retail,
      line_centavos: unit * qty,
      supplier_cost_centavos: p.cost_centavos ?? null,
      supplier_offer_id: p.winning_offer_id ?? null,
      master_product_id: p.master_product_id ?? null,
      expected_availability_date: p.expected_availability_date ?? null,
      stock: p.stock ?? null,
    });
  }
  if (rejeitados.length) throw new ErroPedido(422, "Alguns itens não puderam ser adicionados.", { itens: rejeitados });
  return itens;
}

/** Bloqueio de entregas (admin › Conteúdo): ativo e sem data, ou ativo até a data informada. */
export function entregaBloqueada(bloqueio) {
  if (bloqueio?.ativo !== true) return false;
  return !bloqueio.data || hojeSaoPaulo() < String(bloqueio.data);
}

/** Já pagou algum pedido com este documento? (desconto de primeira compra) */
export async function ehPrimeiraCompra(document) {
  const doc = digitos(document);
  if (!doc) return false;
  const { count } = await db().from("orders").select("id", { count: "exact", head: true }).eq("customer->>document", doc).eq("payment_status", "pago");
  return !count;
}

/**
 * Descontos (regras do admin em site_settings.descontos):
 *  - por seção: % sobre os itens daquela categoria
 *  - primeira compra: % sobre o subtotal (não acumula com o Pix: vale o maior)
 *  - Pix: % sobre o subtotal
 */
export function calcularTotais({ itens, paymentMethod, deliveryMethod, settings, primeiraCompra = false }) {
  const retail = itens.reduce((s, i) => s + i.retail_price_centavos * i.qty, 0);
  const subtotal = itens.reduce((s, i) => s + i.line_centavos, 0);
  const d = settings.descontos || {};
  const secoes = d.secoes || {};
  let descontoSecao = 0;
  for (const it of itens) {
    const pct = Number(secoes[it.category_slug] || 0);
    if (pct > 0) descontoSecao += Math.round((it.line_centavos * pct) / 100);
  }
  const base = subtotal - descontoSecao;
  const pix = metodoEhPix(paymentMethod) ? descontoPixCentavos(base, d) : 0;
  const pctPrimeira = d.primeiraCompra?.ativo && primeiraCompra ? Number(d.primeiraCompra.percentual || 0) : 0;
  const primeira = pctPrimeira > 0 ? Math.round((base * pctPrimeira) / 100) : 0;
  const detalhe = [];
  if (descontoSecao) detalhe.push({ tipo: "secao", valor: descontoSecao });
  let principal = 0;
  if (primeira >= pix && primeira > 0) {
    principal = primeira;
    detalhe.push({ tipo: "primeira-compra", pct: pctPrimeira, valor: primeira });
  } else if (pix > 0) {
    principal = pix;
    detalhe.push({ tipo: "pix", pct: Number(d.pixPct ?? 5), valor: pix });
  }
  const desconto = descontoSecao + principal;
  const { freightCentavos, rule } = calcularFrete({ deliveryMethod, subtotalCentavos: subtotal, frete: settings.frete });
  return {
    retail_subtotal_centavos: retail,
    subtotal_centavos: subtotal,
    wholesale_savings_centavos: retail - subtotal,
    discount_centavos: desconto,
    discount_detail: detalhe.length ? detalhe : null,
    freight_centavos: freightCentavos,
    freight_rule: rule,
    total_centavos: subtotal - desconto + freightCentavos,
  };
}

export function statusIniciais(paymentMethod) {
  if (!METODOS.has(paymentMethod)) throw new ErroPedido(400, "Forma de pagamento inválida.");
  if (paymentMethod === "na-entrega") return { order_status: "em-separacao", payment_status: "pendente" };
  return { order_status: "aguardando-pagamento", payment_status: "pendente" };
}

/* ---------------- criação ---------------- */
export async function criarPedido(body, usuario = null) {
  const b = body || {};
  const customer = b.customer || {};
  const name = String(customer.name || "").trim();
  const document = digitos(customer.document);
  const phone = digitos(customer.phone);
  const email = String(customer.email || "").trim().toLowerCase();

  if (!validarCPF(document) && !validarCNPJ(document)) throw new ErroPedido(400, "CPF ou CNPJ inválido.");
  if (name.length < 3) throw new ErroPedido(400, "Nome do cliente obrigatório.");
  if (phone.length < 10) throw new ErroPedido(400, "Telefone com DDD obrigatório.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroPedido(400, "E-mail inválido.");

  const paymentMethod = String(b.paymentMethod || "");
  const { order_status, payment_status } = statusIniciais(paymentMethod);
  const deliveryMethod = b.deliveryMethod === "pickup" ? "pickup" : "delivery";

  const customerHash = customerHashDe(document);
  checarRateLimit(customerHash);

  const settings = await lerSettings();

  let address = null;
  if (deliveryMethod === "delivery") {
    const a = b.address || {};
    const cep = digitos(a.cep);
    if (cep.length !== 8) throw new ErroPedido(422, "CEP inválido.");
    for (const [k, label] of [["street", "rua"], ["number", "número"], ["district", "bairro"], ["city", "cidade"], ["state", "UF"]]) {
      if (!String(a[k] || "").trim()) throw new ErroPedido(422, `Endereço incompleto: falta ${label}.`);
    }
    if (entregaBloqueada(settings.bloqueio)) {
      throw new ErroPedido(422, settings.bloqueio?.mensagem || "Entregas temporariamente suspensas. Escolha retirada no fornecedor.", { code: "entrega-bloqueada" });
    }
    address = {
      cep,
      street: String(a.street).trim(),
      number: String(a.number).trim(),
      complement: String(a.complement || "").trim() || null,
      district: String(a.district).trim(),
      city: String(a.city).trim(),
      state: String(a.state).trim().toUpperCase().slice(0, 2),
      reference: String(a.reference || "").trim() || null,
    };
  }

  const itens = await montarItens(b.items);
  const primeiraCompra = settings.descontos?.primeiraCompra?.ativo ? await ehPrimeiraCompra(document) : false;
  const totais = calcularTotais({ itens, paymentMethod, deliveryMethod, settings, primeiraCompra });
  if (metodoOnline(paymentMethod) && totais.total_centavos < 1) throw new ErroPedido(400, "Valor mínimo para pagamento online é R$ 0,01.");

  // idempotência: mesmo cliente + mesmo requestId + mesmo carrinho = mesmo pedido
  const clientRequestId = String(b.clientRequestId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId))
    throw new ErroPedido(400, "clientRequestId deve ser um UUID válido.");
  const creationKey = `${customerHash}:${clientRequestId}:${cartHash(b.items)}`;
  {
    const { data: existente } = await db().from("orders").select("id, code, order_status, payment_status, pricing_version, total_centavos, freight_centavos, discount_centavos, subtotal_centavos").eq("creation_key", creationKey).maybeSingle();
    if (existente) return respostaPedido(existente, true);
  }

  const supplierIds = [...new Set(itens.map((i) => i.supplier_id).filter(Boolean))];
  const orderData = {
    profile_id: usuario?.id || null,
    customer: { name, document, phone, email },
    address,
    delivery_method: deliveryMethod,
    delivery_cep: address?.cep || null,
    delivery_date: b.deliveryDate || null,
    delivery_window: b.deliveryWindow || null,
    notes: String(b.notes || "").trim().slice(0, 500) || null,
    origin: String(b.origin || "site").slice(0, 30),
    payment_method: paymentMethod,
    payment_status,
    order_status,
    ...totais,
    pricing_version: 1,
    items_count: itens.reduce((s, i) => s + i.qty, 0),
    supplier_ids: supplierIds,
    creation_key: creationKey,
    customer_hash: customerHash,
    client_request_id: clientRequestId,
  };
  const orderItems = itens.map(({ category_slug: _, expected_availability_date: _ead, stock: _stk, ...rest }) => rest);

  const shipments = computeShipments(itens, deliveryMethod, totais.freight_centavos);

  const { data: criado, error } = await db().rpc("create_order_atomic", { p_order: orderData, p_items: orderItems, p_shipments: shipments });
  if (error) {
    if (/insufficient_stock/.test(error.message || "")) {
      const m = error.message.match(/insufficient_stock:([^:]+)/);
      throw new ErroPedido(409, `Estoque insuficiente para "${(m?.[1] || "produto").trim()}". Atualize o carrinho e tente novamente.`);
    }
    if (/orphan_items/.test(error.message || "")) {
      console.error("[pedido] Itens sem shipment atribuído:", error.message);
      throw new ErroPedido(500, "Erro interno ao agrupar entregas. Tente novamente.");
    }
    throw new ErroPedido(500, "Falha ao criar o pedido.");
  }
  if (criado.reaproveitado) return respostaPedido(criado, true);

  await registrarEvento(criado.id, "criado", { paymentMethod, deliveryMethod, itens: itens.length, total: totais.total_centavos }, usuario ? { kind: "customer", id: usuario.id } : { kind: "system" });
  return respostaPedido(criado, false);
}

function respostaPedido(o, reaproveitado) {
  return {
    ok: true,
    orderId: o.id,
    orderCode: o.code,
    orderStatus: o.order_status,
    paymentStatus: o.payment_status,
    pricingVersion: o.pricing_version,
    reaproveitado,
    totais: {
      subtotalCentavos: o.subtotal_centavos,
      discountCentavos: o.discount_centavos,
      freightCentavos: o.freight_centavos,
      totalCentavos: o.total_centavos,
    },
    shipments: o.shipments || [],
  };
}

/** Só para exibir no checkout (o pedido recalcula tudo de novo ao ser criado). */
export async function calcularFreteParaExibicao(body) {
  const b = body || {};
  const itens = await montarItens(b.items);
  const settings = await lerSettings();
  const primeiraCompra = settings.descontos?.primeiraCompra?.ativo && b.document ? await ehPrimeiraCompra(b.document) : false;
  const t = calcularTotais({ itens, paymentMethod: String(b.paymentMethod || "pix"), deliveryMethod: b.deliveryMethod === "pickup" ? "pickup" : "delivery", settings, primeiraCompra });
  return { ok: true, ...t, bloqueioEntrega: entregaBloqueada(settings.bloqueio) };
}

/** Consulta sem login: CPF/CNPJ + código. Devolve o pedido só se os dois baterem. */
export async function consultarPedido({ document, code }) {
  const doc = digitos(document);
  const cod = String(code || "").trim().toUpperCase();
  if (!(validarCPF(doc) || validarCNPJ(doc)) || !/^[A-Z]{2}\d{4}$/.test(cod)) throw new ErroPedido(404, "Pedido não encontrado.");
  const { data: order } = await db().from("orders").select("id, code, created_at, order_status, payment_status, payment_method, total_centavos, subtotal_centavos, discount_centavos, freight_centavos, wholesale_savings_centavos, items_count, delivery_method, customer, address, pricing_version, paid_at, notes").eq("code", cod).maybeSingle();
  if (!order || digitos(order.customer?.document) !== doc) throw new ErroPedido(404, "Pedido não encontrado.");
  const { data: items } = await db().from("order_items").select("*").eq("order_id", order.id).order("name");
  // não expõe o documento inteiro
  order.customer = { ...order.customer, document: "***" + doc.slice(-4), email: "" };
  return { ok: true, order, items: items || [] };
}
