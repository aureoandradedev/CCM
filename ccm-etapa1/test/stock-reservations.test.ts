// Bloco 1 V2 — Testes das regras de estoque CCM (pure functions).
// 20 regras + cenário de concorrência modelado (200 pedidos × 50 unidades).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeAvailability,
  reserveStock,
  lockForPayment,
  confirmSale,
  releaseStock,
  expirePaymentLocks,
  routeOrderItems,
  DEFAULT_CONFIG,
  type StockReservation,
  type CcmInventoryRow,
  type StockConfig,
  type ReserveItem,
} from "../src/regras2.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

let _counter = 0;
const idGen = () => `id-${++_counter}`;
const resetIds = () => { _counter = 0; };
const NOW = "2026-11-25T10:00:00.000Z";
const LATER = "2026-11-25T10:30:00.000Z";
const EXPIRED = "2026-11-25T09:00:00.000Z";

const enabledConfig: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 15 };

function mkInventory(mpId: string, qty: number): CcmInventoryRow {
  return { masterProductId: mpId, quantity: qty };
}

function mkReservation(
  overrides: Partial<StockReservation> & { id: string; orderId: string; masterProductId: string; qty: number },
): StockReservation {
  return {
    orderItemId: overrides.orderItemId ?? "oi-1",
    status: "reservation",
    lockedAt: null,
    lockExpiresAt: null,
    soldAt: null,
    releasedAt: null,
    ...overrides,
  };
}

// ─── Regra 1: disponivel = fisico - travado_ativo ────────────────────────

describe("R1: disponivel = fisico - pagos - travados_ativos", () => {
  test("estoque 100, 10 vendidos, 5 travados → disponivel = 85", () => {
    const inv = [mkInventory("mp1", 100)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10, status: "sold", soldAt: NOW }),
      mkReservation({ id: "r2", orderId: "o2", masterProductId: "mp1", qty: 5, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].fisico, 100);
    assert.equal(avail[0].pagos, 10);
    assert.equal(avail[0].travados, 5);
    assert.equal(avail[0].disponivel, 85);
  });

  test("disponivel nunca negativo", () => {
    const inv = [mkInventory("mp1", 5)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10, status: "sold", soldAt: NOW }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].disponivel, 0);
  });
});

// ─── Regra 2: reserva não reduz disponibilidade ─────────────────────────

describe("R2: reserva lógica NÃO reduz disponibilidade", () => {
  test("reserva de 20 não muda disponivel", () => {
    const inv = [mkInventory("mp1", 100)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 20, status: "reservation" }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].disponivel, 100);
  });
});

// ─── Regra 3: trava reduz disponibilidade ───────────────────────────────

describe("R3: trava (payment_lock) reduz disponibilidade", () => {
  test("trava de 30 reduz disponivel de 100 para 70", () => {
    const inv = [mkInventory("mp1", 100)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 30, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].travados, 30);
    assert.equal(avail[0].disponivel, 70);
  });
});

// ─── Regra 4: trava expirada não reduz disponibilidade ──────────────────

describe("R4: trava expirada NÃO reduz disponibilidade", () => {
  test("lock com lockExpiresAt no passado não conta como travado", () => {
    const inv = [mkInventory("mp1", 100)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 30, status: "payment_lock", lockedAt: EXPIRED, lockExpiresAt: EXPIRED }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].travados, 0);
    assert.equal(avail[0].disponivel, 100);
  });
});

// ─── Regra 5: pagamento confirmado converte lock → sold ─────────────────

describe("R5: pagamento confirmado converte payment_lock → sold", () => {
  test("confirm promove lock ativo para sold", () => {
    resetIds();
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
    ];
    const { result, updatedReservations } = confirmSale("o1", res, enabledConfig, NOW);
    assert.equal(result.soldCount, 1);
    const sold = updatedReservations.find(r => r.id === "r1")!;
    assert.equal(sold.status, "sold");
    assert.equal(sold.soldAt, NOW);
  });
});

// ─── Regra 6: confirmação duplicada não duplica venda ───────────────────

describe("R6: confirmação duplicada NÃO duplica venda", () => {
  test("chamar confirmSale duas vezes: segunda não converte", () => {
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
    ];
    const { updatedReservations: after1 } = confirmSale("o1", res, enabledConfig, NOW);
    const { result: r2, updatedReservations: after2 } = confirmSale("o1", after1, enabledConfig, LATER);
    assert.equal(r2.soldCount, 0);
    assert.equal(r2.releasedCount, 0);
    const soldCount = after2.filter(r => r.status === "sold").length;
    assert.equal(soldCount, 1);
  });
});

// ─── Regra 7: cancelamento libera lock/reserva ──────────────────────────

describe("R7: cancelamento libera lock e reserva", () => {
  test("release libera reservation e payment_lock, mantém sold", () => {
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 5, status: "reservation" }),
      mkReservation({ id: "r2", orderId: "o1", masterProductId: "mp1", qty: 10, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
      mkReservation({ id: "r3", orderId: "o1", masterProductId: "mp1", qty: 3, status: "sold", soldAt: NOW }),
    ];
    const { result, updatedReservations } = releaseStock("o1", res, enabledConfig, NOW);
    assert.equal(result.releasedCount, 2);
    assert.equal(updatedReservations.filter(r => r.status === "released").length, 2);
    assert.equal(updatedReservations.find(r => r.id === "r3")!.status, "sold");
  });
});

// ─── Regra 8: lock expirado pode ser reaproveitado ──────────────────────

describe("R8: lock expirado libera estoque para outros pedidos", () => {
  test("após expirar lock, disponivel volta e outro pedido pode travar", () => {
    resetIds();
    const inv = [mkInventory("mp1", 10)];
    // Pedido 1 travou 10, mas expirou
    let res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10, status: "payment_lock", lockedAt: EXPIRED, lockExpiresAt: EXPIRED }),
    ];
    // Pedido 2 reserva 5
    const reserve2 = reserveStock("o2", [{ orderItemId: "oi-2", masterProductId: "mp1", qty: 5 }], res, enabledConfig, idGen);
    res = [...res, ...reserve2.created];
    // Lock do pedido 2 — deve expirar o lock do pedido 1 e liberar estoque
    const { summary, updatedReservations } = lockForPayment("o2", res, inv, enabledConfig, NOW, idGen);
    assert.equal(summary.travado, 5);
    assert.equal(summary.faltou, 0);
    // Pedido 1 expired lock is now released
    const o1Lock = updatedReservations.find(r => r.id === "r1")!;
    assert.equal(o1Lock.status, "released");
  });
});

// ─── Regra 9: pedido só com estoque CCM → direto para pagamento ─────────

describe("R9: pedido 100% CCM pode seguir direto para pagamento", () => {
  test("tudo CCM quando disponivel >= qty", () => {
    const inv = [mkInventory("mp1", 50)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 1);
    assert.equal(routing.ccmItems[0].qty, 10);
    assert.equal(routing.supplierItems.length, 0);
  });
});

// ─── Regra 10: sem estoque CCM → fluxo fornecedor ──────────────────────

describe("R10: sem estoque CCM → tudo para fornecedor", () => {
  test("produto sem inventário CCM vai para supplier", () => {
    const inv: CcmInventoryRow[] = [];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp-no-ccm", qty: 10 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 0);
    assert.equal(routing.supplierItems.length, 1);
    assert.equal(routing.supplierItems[0].qty, 10);
  });
});

// ─── Regra 11: split parcial ────────────────────────────────────────────

describe("R11: split parcial — CCM + fornecedor", () => {
  test("30 disponíveis, pedido de 50: 30 CCM + 20 fornecedor", () => {
    const inv = [mkInventory("mp1", 30)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 50 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 1);
    assert.equal(routing.ccmItems[0].qty, 30);
    assert.equal(routing.supplierItems.length, 1);
    assert.equal(routing.supplierItems[0].qty, 20);
  });

  test("lock parcial: 7 de 10 travados, 3 ficam como reservation (supplier)", () => {
    resetIds();
    const inv = [mkInventory("mp1", 7)];
    const resItem: ReserveItem = { orderItemId: "oi-1", masterProductId: "mp1", qty: 10 };
    const reserve = reserveStock("o1", [resItem], [], enabledConfig, idGen);
    const { summary, updatedReservations } = lockForPayment("o1", reserve.created, inv, enabledConfig, NOW, idGen);
    assert.equal(summary.travado, 7);
    assert.equal(summary.faltou, 3);
    const locked = updatedReservations.filter(r => r.status === "payment_lock");
    const remaining = updatedReservations.filter(r => r.status === "reservation");
    assert.equal(locked.length, 1);
    assert.equal(locked[0].qty, 7);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].qty, 3);
  });
});

// ─── Regra 12: recalcula split no momento do pagamento ──────────────────

describe("R12: disponibilidade insuficiente no pagamento recalcula split", () => {
  test("reservou 20, mas entre-tempo só 8 disponíveis → trava 8 + falta 12", () => {
    resetIds();
    const inv = [mkInventory("mp1", 20)];
    // Pedido 1 reserva 20
    const r1 = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 20 }], [], enabledConfig, idGen);
    // Outro pedido vendeu 12 nesse meio-tempo
    const otherSold: StockReservation = mkReservation({ id: "r-other", orderId: "o-other", masterProductId: "mp1", qty: 12, status: "sold", soldAt: NOW });
    const allRes = [...r1.created, otherSold];
    const { summary } = lockForPayment("o1", allRes, inv, enabledConfig, NOW, idGen);
    assert.equal(summary.travado, 8);
    assert.equal(summary.faltou, 12);
  });
});

// ─── Regra 13: nunca quantidade negativa ────────────────────────────────

describe("R13: nunca permitir quantidade negativa", () => {
  test("disponivel é 0 quando compromissos excedem físico", () => {
    const inv = [mkInventory("mp1", 5)];
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 8, status: "sold", soldAt: NOW }),
    ];
    const avail = computeAvailability(inv, res, NOW);
    assert.equal(avail[0].disponivel, 0);
    assert.ok(avail[0].disponivel >= 0);
  });

  test("lock não trava quantidade negativa quando estoque zerou", () => {
    resetIds();
    const inv = [mkInventory("mp1", 0)];
    const reserve = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }], [], enabledConfig, idGen);
    const { summary } = lockForPayment("o1", reserve.created, inv, enabledConfig, NOW, idGen);
    assert.equal(summary.travado, 0);
    assert.equal(summary.faltou, 10);
  });
});

// ─── Regra 14: nunca vender/travar acima do físico ──────────────────────

describe("R14: nunca vender/travar acima do físico", () => {
  test("dois pedidos de 60 em estoque de 100: total travado = 100, não 120", () => {
    resetIds();
    const inv = [mkInventory("mp1", 100)];
    // Pedido 1 reserva 60
    const r1 = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 60 }], [], enabledConfig, idGen);
    // Pedido 2 reserva 60
    const r2 = reserveStock("o2", [{ orderItemId: "oi-2", masterProductId: "mp1", qty: 60 }], r1.created, enabledConfig, idGen);
    let allRes = [...r1.created, ...r2.created];
    // Lock pedido 1
    const lock1 = lockForPayment("o1", allRes, inv, enabledConfig, NOW, idGen);
    assert.equal(lock1.summary.travado, 60);
    // Lock pedido 2 — only 40 left
    const lock2 = lockForPayment("o2", lock1.updatedReservations, inv, enabledConfig, NOW, idGen);
    assert.equal(lock2.summary.travado, 40);
    assert.equal(lock2.summary.faltou, 20);
    // Total travado never exceeds physical
    const totalLocked = lock2.updatedReservations
      .filter(r => r.status === "payment_lock")
      .reduce((acc, r) => acc + r.qty, 0);
    assert.ok(totalLocked <= 100);
  });
});

// ─── Regra 15: TTL usa config, não hardcoded ────────────────────────────

describe("R15: lock TTL usa config recebida", () => {
  test("TTL de 30 minutos gera expiresAt correto", () => {
    resetIds();
    const config30: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 30 };
    const inv = [mkInventory("mp1", 10)];
    const reserve = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 5 }], [], config30, idGen);
    const { summary } = lockForPayment("o1", reserve.created, inv, config30, NOW, idGen);
    const expected = new Date(NOW);
    expected.setMinutes(expected.getMinutes() + 30);
    assert.equal(summary.expiresAt, expected.toISOString());
  });

  test("TTL de 5 minutos gera expiresAt correto", () => {
    resetIds();
    const config5: StockConfig = { ccmStockEnabled: true, paymentLockTtlMinutes: 5 };
    const inv = [mkInventory("mp1", 10)];
    const reserve = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 5 }], [], config5, idGen);
    const { summary } = lockForPayment("o1", reserve.created, inv, config5, NOW, idGen);
    const expected = new Date(NOW);
    expected.setMinutes(expected.getMinutes() + 5);
    assert.equal(summary.expiresAt, expected.toISOString());
  });
});

// ─── Regra 16: idempotência ─────────────────────────────────────────────

describe("R16: mesma chamada repetida é idempotente", () => {
  test("reserveStock: segunda chamada para mesmo orderId retorna skipped", () => {
    resetIds();
    const existing = [mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 10 })];
    const result = reserveStock("o1", [{ orderItemId: "oi-2", masterProductId: "mp1", qty: 5 }], existing, enabledConfig, idGen);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already_reserved");
    assert.equal(result.created.length, 0);
  });

  test("lockForPayment: segunda chamada retorna skipped + already_locked", () => {
    resetIds();
    const inv = [mkInventory("mp1", 50)];
    const reserve = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }], [], enabledConfig, idGen);
    const lock1 = lockForPayment("o1", reserve.created, inv, enabledConfig, NOW, idGen);
    const lock2 = lockForPayment("o1", lock1.updatedReservations, inv, enabledConfig, NOW, idGen);
    assert.equal(lock2.summary.skipped, true);
    assert.equal(lock2.summary.reason, "already_locked");
  });
});

// ─── Regra 17: dois clientes disputando mesma quantidade ────────────────

describe("R17: dois clientes disputando mesma quantidade respeitam capacidade", () => {
  test("estoque 10: pedido A=7, pedido B=7 → A trava 7, B trava 3", () => {
    resetIds();
    const inv = [mkInventory("mp1", 10)];
    const rA = reserveStock("oA", [{ orderItemId: "oi-A", masterProductId: "mp1", qty: 7 }], [], enabledConfig, idGen);
    const rB = reserveStock("oB", [{ orderItemId: "oi-B", masterProductId: "mp1", qty: 7 }], rA.created, enabledConfig, idGen);
    let allRes = [...rA.created, ...rB.created];
    const lockA = lockForPayment("oA", allRes, inv, enabledConfig, NOW, idGen);
    assert.equal(lockA.summary.travado, 7);
    const lockB = lockForPayment("oB", lockA.updatedReservations, inv, enabledConfig, NOW, idGen);
    assert.equal(lockB.summary.travado, 3);
    assert.equal(lockB.summary.faltou, 4);
    // Total locked = 10 = physical
    const totalLocked = lockB.updatedReservations
      .filter(r => r.status === "payment_lock")
      .reduce((acc, r) => acc + r.qty, 0);
    assert.equal(totalLocked, 10);
  });
});

// ─── Regra 18: estoque 0 → tudo fornecedor ──────────────────────────────

describe("R18: estoque 0 → tudo para fornecedor", () => {
  test("inventário com quantity=0 → routing envia tudo para supplier", () => {
    const inv = [mkInventory("mp1", 0)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 15 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 0);
    assert.equal(routing.supplierItems.length, 1);
    assert.equal(routing.supplierItems[0].qty, 15);
  });
});

// ─── Regra 19: estoque suficiente → tudo CCM ────────────────────────────

describe("R19: estoque suficiente → tudo CCM", () => {
  test("disponivel 100 ≥ pedido 50 → 100% CCM", () => {
    const inv = [mkInventory("mp1", 100)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 50 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 1);
    assert.equal(routing.ccmItems[0].qty, 50);
    assert.equal(routing.supplierItems.length, 0);
  });
});

// ─── Regra 20: estoque parcial → divisão correta ────────────────────────

describe("R20: estoque parcial → divisão correta", () => {
  test("disponivel 25, pedido 40 → CCM 25 + supplier 15", () => {
    const inv = [mkInventory("mp1", 25)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 40 }];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems[0].qty, 25);
    assert.equal(routing.supplierItems[0].qty, 15);
  });

  test("multiprodutos: mp1 tem 10, mp2 tem 0 → mp1 CCM, mp2 supplier", () => {
    const inv = [mkInventory("mp1", 10)];
    const items: ReserveItem[] = [
      { orderItemId: "oi-1", masterProductId: "mp1", qty: 5 },
      { orderItemId: "oi-2", masterProductId: "mp2", qty: 8 },
    ];
    const routing = routeOrderItems(items, inv, [], enabledConfig, NOW);
    assert.equal(routing.ccmItems.length, 1);
    assert.equal(routing.ccmItems[0].masterProductId, "mp1");
    assert.equal(routing.supplierItems.length, 1);
    assert.equal(routing.supplierItems[0].masterProductId, "mp2");
  });
});

// ─── Feature flag OFF: tudo skipped ─────────────────────────────────────

describe("Feature flag OFF: todas operações são no-op", () => {
  test("reserve com flag OFF retorna skipped", () => {
    resetIds();
    const result = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }], [], DEFAULT_CONFIG, idGen);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "ccm_stock_disabled");
  });

  test("lock com flag OFF retorna skipped", () => {
    resetIds();
    const { summary } = lockForPayment("o1", [], [], DEFAULT_CONFIG, NOW, idGen);
    assert.equal(summary.skipped, true);
  });

  test("confirm com flag OFF retorna skipped", () => {
    const { result } = confirmSale("o1", [], DEFAULT_CONFIG, NOW);
    assert.equal(result.skipped, true);
  });

  test("release com flag OFF retorna skipped", () => {
    const { result } = releaseStock("o1", [], DEFAULT_CONFIG, NOW);
    assert.equal(result.skipped, true);
  });

  test("routing com flag OFF → tudo para supplier", () => {
    const inv = [mkInventory("mp1", 100)];
    const items: ReserveItem[] = [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }];
    const routing = routeOrderItems(items, inv, [], DEFAULT_CONFIG, NOW);
    assert.equal(routing.ccmItems.length, 0);
    assert.equal(routing.supplierItems.length, 1);
  });
});

// ─── Expire mechanism ───────────────────────────────────────────────────

describe("Expire: pg_cron expira locks vencidos", () => {
  test("expira 2 locks vencidos, mantém 1 ativo", () => {
    const res: StockReservation[] = [
      mkReservation({ id: "r1", orderId: "o1", masterProductId: "mp1", qty: 5, status: "payment_lock", lockedAt: EXPIRED, lockExpiresAt: EXPIRED }),
      mkReservation({ id: "r2", orderId: "o2", masterProductId: "mp1", qty: 3, status: "payment_lock", lockedAt: EXPIRED, lockExpiresAt: EXPIRED }),
      mkReservation({ id: "r3", orderId: "o3", masterProductId: "mp1", qty: 10, status: "payment_lock", lockedAt: NOW, lockExpiresAt: "2026-11-25T10:15:00.000Z" }),
    ];
    const { result, updatedReservations } = expirePaymentLocks(res, NOW);
    assert.equal(result.expiredCount, 2);
    assert.equal(updatedReservations.filter(r => r.status === "released").length, 2);
    assert.equal(updatedReservations.find(r => r.id === "r3")!.status, "payment_lock");
  });
});

// ─── Full lifecycle ─────────────────────────────────────────────────────

describe("Full lifecycle: reserve → lock → confirm", () => {
  test("happy path: reserve, lock, confirm → sold", () => {
    resetIds();
    const inv = [mkInventory("mp1", 50)];
    // 1. Reserve
    const reserve = reserveStock("o1", [{ orderItemId: "oi-1", masterProductId: "mp1", qty: 10 }], [], enabledConfig, idGen);
    assert.equal(reserve.created.length, 1);
    assert.equal(reserve.created[0].status, "reservation");
    // 2. Lock
    const lock = lockForPayment("o1", reserve.created, inv, enabledConfig, NOW, idGen);
    assert.equal(lock.summary.travado, 10);
    assert.equal(lock.summary.faltou, 0);
    // 3. Confirm
    const { result, updatedReservations } = confirmSale("o1", lock.updatedReservations, enabledConfig, NOW);
    assert.equal(result.soldCount, 1);
    const finalRow = updatedReservations.find(r => r.orderId === "o1" && r.status === "sold")!;
    assert.equal(finalRow.qty, 10);
    // Availability
    const avail = computeAvailability(inv, updatedReservations, NOW);
    assert.equal(avail[0].disponivel, 40);
  });
});

// ─── Concurrency model: 200 pedidos × 50 unidades ──────────────────────

describe("Concurrency model: 200 orders competing for 50 units", () => {
  test("exactly 50 units locked/sold, never 51, rest get shortage", () => {
    resetIds();
    const inv = [mkInventory("mp1", 50)];
    const ORDER_COUNT = 200;
    const QTY_PER_ORDER = 1;
    let allRes: StockReservation[] = [];

    // Phase 1: all 200 orders reserve 1 unit each
    for (let i = 0; i < ORDER_COUNT; i++) {
      const orderId = `order-${i}`;
      const reserve = reserveStock(
        orderId,
        [{ orderItemId: `oi-${i}`, masterProductId: "mp1", qty: QTY_PER_ORDER }],
        allRes,
        enabledConfig,
        idGen,
      );
      allRes = [...allRes, ...reserve.created];
    }
    assert.equal(allRes.length, 200);

    // Phase 2: all try to lock (sequential, simulating DB serialization)
    let totalTravado = 0;
    let totalFaltou = 0;
    for (let i = 0; i < ORDER_COUNT; i++) {
      const orderId = `order-${i}`;
      const { summary, updatedReservations } = lockForPayment(orderId, allRes, inv, enabledConfig, NOW, idGen);
      allRes = updatedReservations;
      totalTravado += summary.travado;
      totalFaltou += summary.faltou;
    }

    // Exactly 50 locked, 150 short
    assert.equal(totalTravado, 50);
    assert.equal(totalFaltou, 150);

    // Verify: total payment_lock qty = 50
    const lockedQty = allRes
      .filter(r => r.status === "payment_lock")
      .reduce((acc, r) => acc + r.qty, 0);
    assert.equal(lockedQty, 50);

    // Never exceeds physical
    assert.ok(lockedQty <= 50);

    // Phase 3: confirm all locked orders
    for (let i = 0; i < ORDER_COUNT; i++) {
      const { updatedReservations } = confirmSale(`order-${i}`, allRes, enabledConfig, NOW);
      allRes = updatedReservations;
    }

    const soldQty = allRes
      .filter(r => r.status === "sold")
      .reduce((acc, r) => acc + r.qty, 0);
    assert.equal(soldQty, 50);

    // Availability: fisico=50, sold=50, disponivel=0
    const avail = computeAvailability(inv, allRes, NOW);
    assert.equal(avail[0].fisico, 50);
    assert.equal(avail[0].pagos, 50);
    assert.equal(avail[0].disponivel, 0);
  });

  test("200 orders of varying qty (1-5) against 50 units: invariants hold", () => {
    resetIds();
    const inv = [mkInventory("mp1", 50)];
    let allRes: StockReservation[] = [];

    // Reserve varying quantities
    for (let i = 0; i < 200; i++) {
      const qty = (i % 5) + 1;
      const reserve = reserveStock(
        `order-${i}`,
        [{ orderItemId: `oi-${i}`, masterProductId: "mp1", qty }],
        allRes,
        enabledConfig,
        idGen,
      );
      allRes = [...allRes, ...reserve.created];
    }

    // Lock all
    let totalTravado = 0;
    for (let i = 0; i < 200; i++) {
      const { summary, updatedReservations } = lockForPayment(`order-${i}`, allRes, inv, enabledConfig, NOW, idGen);
      allRes = updatedReservations;
      totalTravado += summary.travado;
    }

    // Total locked never exceeds 50
    const lockedQty = allRes
      .filter(r => r.status === "payment_lock")
      .reduce((acc, r) => acc + r.qty, 0);
    assert.ok(lockedQty <= 50, `locked ${lockedQty} > physical 50`);
    assert.equal(lockedQty, totalTravado);

    // No negative availability
    const avail = computeAvailability(inv, allRes, NOW);
    assert.ok(avail[0].disponivel >= 0);
  });
});
