// Bloco 1 V2 — Etapa 3: Testes da integração reserva CCM × checkout.
// 10 cenários obrigatórios + extras.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  routeOrderForCheckout,
  buildSupplierPayload,
  computeCheckoutStock,
  type OrderItem,
  type CheckoutRouting,
} from "../src/regras3.ts";
import {
  computeAvailability,
  reserveStock,
  type StockConfig,
  type CcmInventoryRow,
  type StockReservation,
  DEFAULT_CONFIG,
} from "../src/regras2.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

const ON: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 15 };
const OFF: StockConfig = DEFAULT_CONFIG;

function mkItem(overrides: Partial<OrderItem> & { product_id: string; qty: number }): OrderItem {
  return {
    supplier_id: "sup-1",
    master_product_id: null,
    name: `Product ${overrides.product_id}`,
    unit: "un",
    supplier_cost_centavos: 1000,
    unit_price_centavos: 1500,
    ...overrides,
  };
}

function oiMapFrom(itens: OrderItem[]): Map<string, string> {
  return new Map(itens.map((i) => [i.product_id, `oi-${i.product_id}`]));
}

// ─── T1: flag OFF → fluxo antigo intacto ─────────────────────────────────

describe("T1: flag OFF → fluxo antigo intacto", () => {
  test("todas operações retornam disabled, supplier recebe qty original", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "p1", qty: 10, master_product_id: "mp1" }),
      mkItem({ product_id: "p2", qty: 5, master_product_id: "mp2" }),
    ];
    const oiMap = oiMapFrom(itens);
    const avail = new Map([["mp1", 50], ["mp2", 30]]);

    const result = computeCheckoutStock(itens, ["sup-1"], oiMap, avail, OFF);

    assert.equal(result.routing.disabled, true);
    assert.equal(result.routing.ccmReservations.length, 0);
    assert.equal(result.supplierPayload.length, 1);
    assert.equal(result.supplierPayload[0].items.length, 2);
    assert.equal(result.supplierPayload[0].items[0].quantity, 10);
    assert.equal(result.supplierPayload[0].items[1].quantity, 5);
    assert.equal(result.allCcm, false);
  });

  test("flag OFF: routing.disabled = true mesmo com estoque CCM sobrando", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 1, master_product_id: "mp1" })];
    const routing = routeOrderForCheckout(itens, oiMapFrom(itens), new Map([["mp1", 999]]), OFF);
    assert.equal(routing.disabled, true);
    assert.equal(routing.ccmReservations.length, 0);
  });
});

// ─── T2: estoque 0 → tudo fornecedor ────────────────────────────────────

describe("T2: estoque 0 → tudo fornecedor", () => {
  test("disponivel 0 → nenhuma reserva CCM, tudo para supplier", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 10, master_product_id: "mp1" })];
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), new Map([["mp1", 0]]), ON);

    assert.equal(result.routing.ccmReservations.length, 0);
    assert.equal(result.supplierPayload.length, 1);
    assert.equal(result.supplierPayload[0].items[0].quantity, 10);
    assert.equal(result.allCcm, false);
  });

  test("master_product sem entrada em ccm_inventory → tudo fornecedor", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 10, master_product_id: "mp-unknown" })];
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), new Map(), ON);

    assert.equal(result.routing.ccmReservations.length, 0);
    assert.equal(result.supplierPayload[0].items[0].quantity, 10);
  });
});

// ─── T3: estoque suficiente → tudo CCM ──────────────────────────────────

describe("T3: estoque suficiente → tudo CCM", () => {
  test("disponivel 50 ≥ pedido 10 → reserva CCM total, zero para supplier", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 10, master_product_id: "mp1" })];
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), new Map([["mp1", 50]]), ON);

    assert.equal(result.routing.ccmReservations.length, 1);
    assert.equal(result.routing.ccmReservations[0].qty, 10);
    assert.equal(result.supplierPayload.length, 0);
    assert.equal(result.allCcm, true);
  });
});

// ─── T4: estoque parcial → split correto ────────────────────────────────

describe("T4: estoque parcial → split correto", () => {
  test("disponivel 4, pedido 6 → CCM 4 + supplier 2", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 6, master_product_id: "mp1" })];
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), new Map([["mp1", 4]]), ON);

    assert.equal(result.routing.ccmReservations.length, 1);
    assert.equal(result.routing.ccmReservations[0].qty, 4);
    assert.equal(result.supplierPayload.length, 1);
    assert.equal(result.supplierPayload[0].items[0].quantity, 2);
  });

  test("split: ccm_qty + supplier_qty = pedido_qty", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 100, master_product_id: "mp1" })];
    const avail = new Map([["mp1", 37]]);
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), avail, ON);

    const ccmQty = result.routing.ccmReservations[0].qty;
    const supQty = result.supplierPayload[0].items[0].quantity;
    assert.equal(ccmQty + supQty, 100);
  });
});

// ─── T5: pedido misto CCM + fornecedor ──────────────────────────────────

describe("T5: pedido misto — Item A CCM, Item B fornecedor", () => {
  test("Item A 100% CCM, Item B sem estoque CCM → supplier_request só para B", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "pA", qty: 5, master_product_id: "mpA", supplier_id: "sup-1" }),
      mkItem({ product_id: "pB", qty: 8, master_product_id: "mpB", supplier_id: "sup-1" }),
    ];
    const avail = new Map([["mpA", 10], ["mpB", 0]]);
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), avail, ON);

    assert.equal(result.routing.ccmReservations.length, 1);
    assert.equal(result.routing.ccmReservations[0].master_product_id, "mpA");
    assert.equal(result.routing.ccmReservations[0].qty, 5);

    assert.equal(result.supplierPayload.length, 1);
    assert.equal(result.supplierPayload[0].items.length, 1);
    assert.equal(result.supplierPayload[0].items[0].product_name, "Product pB");
    assert.equal(result.supplierPayload[0].items[0].quantity, 8);
  });

  test("multi-supplier: sup-1 todo CCM, sup-2 todo supplier", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "pA", qty: 3, master_product_id: "mpA", supplier_id: "sup-1" }),
      mkItem({ product_id: "pB", qty: 7, master_product_id: "mpB", supplier_id: "sup-2" }),
    ];
    const avail = new Map([["mpA", 20]]);
    const result = computeCheckoutStock(itens, ["sup-1", "sup-2"], oiMapFrom(itens), avail, ON);

    assert.equal(result.routing.ccmReservations.length, 1);
    assert.equal(result.routing.ccmReservations[0].qty, 3);
    assert.equal(result.supplierPayload.length, 1);
    assert.equal(result.supplierPayload[0].supplier_id, "sup-2");
    assert.equal(result.supplierPayload[0].items[0].quantity, 7);
  });
});

// ─── T6: 100% CCM → zero supplier_requests ──────────────────────────────

describe("T6: 100% CCM → zero supplier_requests", () => {
  test("todos itens atendidos por CCM: supplierPayload vazio", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "pA", qty: 5, master_product_id: "mpA", supplier_id: "sup-1" }),
      mkItem({ product_id: "pB", qty: 3, master_product_id: "mpB", supplier_id: "sup-2" }),
    ];
    const avail = new Map([["mpA", 100], ["mpB", 100]]);
    const result = computeCheckoutStock(itens, ["sup-1", "sup-2"], oiMapFrom(itens), avail, ON);

    assert.equal(result.allCcm, true);
    assert.equal(result.supplierPayload.length, 0);
    assert.equal(result.routing.ccmReservations.length, 2);
  });
});

// ─── T7: quantidade total preservada ─────────────────────────────────────

describe("T7: quantidade total preservada (ccm + supplier = pedido)", () => {
  test("split em vários itens: soma sempre bate", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "p1", qty: 20, master_product_id: "mp1", supplier_id: "sup-1" }),
      mkItem({ product_id: "p2", qty: 15, master_product_id: "mp2", supplier_id: "sup-1" }),
      mkItem({ product_id: "p3", qty: 8, master_product_id: "mp3", supplier_id: "sup-2" }),
    ];
    const avail = new Map([["mp1", 12], ["mp2", 15], ["mp3", 3]]);
    const result = computeCheckoutStock(itens, ["sup-1", "sup-2"], oiMapFrom(itens), avail, ON);

    for (const item of itens) {
      const ccmQty = result.routing.ccmReservations
        .filter((r) => r.order_item_id === `oi-${item.product_id}`)
        .reduce((s, r) => s + r.qty, 0);
      const supQty = result.routing.supplierQtyByProduct.get(item.product_id) ?? 0;
      assert.equal(ccmQty + supQty, item.qty, `Total mismatch for ${item.product_id}: ${ccmQty}+${supQty} != ${item.qty}`);
    }
  });

  test("flag OFF: supplier qty = pedido qty para todo item", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "p1", qty: 20, master_product_id: "mp1" }),
    ];
    const routing = routeOrderForCheckout(itens, oiMapFrom(itens), new Map([["mp1", 100]]), OFF);
    assert.equal(routing.supplierQtyByProduct.get("p1"), 20);
  });
});

// ─── T8: repetição idempotente ───────────────────────────────────────────

describe("T8: repetição idempotente", () => {
  test("routeOrderForCheckout com mesmos inputs retorna mesmo resultado", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 10, master_product_id: "mp1" })];
    const oiMap = oiMapFrom(itens);
    const avail = new Map([["mp1", 7]]);

    const r1 = routeOrderForCheckout(itens, oiMap, avail, ON);
    const r2 = routeOrderForCheckout(itens, oiMap, avail, ON);

    assert.deepEqual(r1.ccmReservations, r2.ccmReservations);
    assert.deepEqual([...r1.supplierQtyByProduct], [...r2.supplierQtyByProduct]);
  });

  test("buildSupplierPayload com mesmo routing retorna payload idêntico", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 10, master_product_id: "mp1" })];
    const oiMap = oiMapFrom(itens);
    const routing = routeOrderForCheckout(itens, oiMap, new Map([["mp1", 4]]), ON);

    const p1 = buildSupplierPayload(["sup-1"], itens, oiMap, routing);
    const p2 = buildSupplierPayload(["sup-1"], itens, oiMap, routing);

    assert.deepEqual(p1, p2);
  });

  test("reserve_ccm_stock RPC idempotência (via regras2.reserveStock)", () => {
    let counter = 0;
    const idGen = () => `id-${++counter}`;
    const existing = [{
      id: "r1", orderId: "o1", orderItemId: "oi-1",
      masterProductId: "mp1", qty: 10, status: "reservation" as const,
      lockedAt: null, lockExpiresAt: null, soldAt: null, releasedAt: null,
    }];
    const result = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }], existing, ON, idGen);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already_reserved");
  });
});

// ─── T9: customer A não interfere na reserva do B ───────────────────────

describe("T9: pedidos independentes não interferem entre si", () => {
  test("routing de A e B usam mesma disponibilidade mas cada um recebe split independente", () => {
    const itensA: OrderItem[] = [mkItem({ product_id: "pA", qty: 7, master_product_id: "mp1", supplier_id: "sup-1" })];
    const itensB: OrderItem[] = [mkItem({ product_id: "pB", qty: 7, master_product_id: "mp1", supplier_id: "sup-1" })];
    const avail = new Map([["mp1", 10]]);

    // A e B fazem routing INDEPENDENTE (reserva NÃO reduz disponibilidade)
    const rA = routeOrderForCheckout(itensA, new Map([["pA", "oiA"]]), avail, ON);
    const rB = routeOrderForCheckout(itensB, new Map([["pB", "oiB"]]), avail, ON);

    // Ambos veem 10 disponíveis (reserva NÃO reduz)
    assert.equal(rA.ccmReservations[0].qty, 7);
    assert.equal(rA.supplierQtyByProduct.get("pA"), 0);
    assert.equal(rB.ccmReservations[0].qty, 7);
    assert.equal(rB.supplierQtyByProduct.get("pB"), 0);
  });
});

// ─── T10: reserva não reduz ccm_stock_available.disponivel ──────────────

describe("T10: reserva NÃO reduz disponibilidade na vitrine", () => {
  test("após reserva, computeAvailability não muda", () => {
    const inv: CcmInventoryRow[] = [{ masterProductId: "mp1", quantity: 50 }];
    const reservations: StockReservation[] = [
      {
        id: "r1", orderId: "o1", orderItemId: "oi-1",
        masterProductId: "mp1", qty: 20, status: "reservation",
        lockedAt: null, lockExpiresAt: null, soldAt: null, releasedAt: null,
      },
    ];
    const avail = computeAvailability(inv, reservations, "2026-11-25T10:00:00.000Z");
    assert.equal(avail[0].disponivel, 50);
  });

  test("100 reservas de 1 un cada: disponivel permanece inalterado", () => {
    const inv: CcmInventoryRow[] = [{ masterProductId: "mp1", quantity: 50 }];
    const reservations: StockReservation[] = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`, orderId: `o${i}`, orderItemId: `oi${i}`,
      masterProductId: "mp1", qty: 1, status: "reservation" as const,
      lockedAt: null, lockExpiresAt: null, soldAt: null, releasedAt: null,
    }));
    const avail = computeAvailability(inv, reservations, "2026-11-25T10:00:00.000Z");
    assert.equal(avail[0].disponivel, 50);
  });
});

// ─── Extras: edge cases ──────────────────────────────────────────────────

describe("Edge: item sem master_product_id → tudo fornecedor", () => {
  test("produto legado sem master_product_id vai todo para supplier", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p-legacy", qty: 5, master_product_id: null })];
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), new Map(), ON);
    assert.equal(result.routing.ccmReservations.length, 0);
    assert.equal(result.supplierPayload[0].items[0].quantity, 5);
  });
});

describe("Edge: dois itens mesmo master_product_id consomem disponível", () => {
  test("mp1 tem 5: item A pede 3, item B pede 4 → A=3 CCM, B=2 CCM + 2 supplier", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "pA", qty: 3, master_product_id: "mp1", supplier_id: "sup-1" }),
      mkItem({ product_id: "pB", qty: 4, master_product_id: "mp1", supplier_id: "sup-1" }),
    ];
    const avail = new Map([["mp1", 5]]);
    const result = computeCheckoutStock(itens, ["sup-1"], oiMapFrom(itens), avail, ON);

    const ccmA = result.routing.ccmReservations.find((r) => r.order_item_id === "oi-pA")!;
    const ccmB = result.routing.ccmReservations.find((r) => r.order_item_id === "oi-pB")!;
    assert.equal(ccmA.qty, 3);
    assert.equal(ccmB.qty, 2);
    assert.equal(result.routing.supplierQtyByProduct.get("pA"), 0);
    assert.equal(result.routing.supplierQtyByProduct.get("pB"), 2);

    // Total CCM + supplier = total pedido
    assert.equal(ccmA.qty + 0, 3);
    assert.equal(ccmB.qty + 2, 4);
  });
});

describe("Edge: supplier sem itens restantes é filtrado do payload", () => {
  test("sup-1 todo CCM, sup-2 todo CCM → supplierPayload vazio", () => {
    const itens: OrderItem[] = [
      mkItem({ product_id: "pA", qty: 2, master_product_id: "mpA", supplier_id: "sup-1" }),
      mkItem({ product_id: "pB", qty: 3, master_product_id: "mpB", supplier_id: "sup-2" }),
    ];
    const avail = new Map([["mpA", 10], ["mpB", 10]]);
    const result = computeCheckoutStock(itens, ["sup-1", "sup-2"], oiMapFrom(itens), avail, ON);

    assert.equal(result.supplierPayload.length, 0);
  });
});

describe("Edge: reservation payload matches reserve_ccm_stock RPC format", () => {
  test("ccmReservations has order_item_id, master_product_id, qty", () => {
    const itens: OrderItem[] = [mkItem({ product_id: "p1", qty: 5, master_product_id: "mp1" })];
    const routing = routeOrderForCheckout(itens, oiMapFrom(itens), new Map([["mp1", 10]]), ON);
    const r = routing.ccmReservations[0];
    assert.equal(typeof r.order_item_id, "string");
    assert.equal(typeof r.master_product_id, "string");
    assert.equal(typeof r.qty, "number");
    assert.ok(r.qty > 0);
  });
});
