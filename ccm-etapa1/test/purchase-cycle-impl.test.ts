// Testes da implementação TS (purchase-cycle.ts) contra regras Etapa 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextOrderDay, addBusinessDays, calculateExpectedAvailabilityDate,
  calculatePackagePurchase, checkPriceChangeLimit, calculateBoxPrice,
} from "../../src/lib/purchase-cycle.ts";

const date = (s: string) => new Date(s + "T12:00:00");

// ── nextOrderDay ───────────────────────────────────────────────────────────
test("nextOrderDay: dia de pedido hoje antes do corte → retorna hoje", () => {
  // 2026-11-13 = sexta = dow 5
  const d = nextOrderDay([5], date("2026-11-13"), false);
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-13");
});

test("nextOrderDay: dia de pedido hoje depois do corte → retorna próximo", () => {
  // 2026-11-13 = sexta = dow 5, próxima sexta = 2026-11-20
  const d = nextOrderDay([5], date("2026-11-13"), true);
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-20");
});

test("nextOrderDay: sem dias de pedido → null", () => {
  assert.equal(nextOrderDay([], date("2026-11-13")), null);
});

// ── addBusinessDays ────────────────────────────────────────────────────────
test("addBusinessDays: 2 dias úteis a partir de sexta = terça", () => {
  const d = addBusinessDays(date("2026-11-13"), 2);
  assert.equal(d.toISOString().slice(0, 10), "2026-11-17");
});

test("addBusinessDays: pula feriados", () => {
  // seg 16 é feriado → 2 dias úteis a partir de sex 13 = ter 17 (+1 pula seg feriado) e qua 18
  const d = addBusinessDays(date("2026-11-13"), 2, ["2026-11-16"]);
  assert.equal(d.toISOString().slice(0, 10), "2026-11-18");
});

test("addBusinessDays: 0 dias = data de partida", () => {
  const d = addBusinessDays(date("2026-11-13"), 0);
  assert.equal(d.toISOString().slice(0, 10), "2026-11-13");
});

// ── calculateExpectedAvailabilityDate ──────────────────────────────────────
test("calculateExpectedAvailabilityDate: qua → pedido sex → +2 dias úteis = ter", () => {
  const r = calculateExpectedAvailabilityDate([2, 5], 2, date("2026-11-11"), false);
  assert.ok(r);
  assert.equal(r!.orderDay, "2026-11-13");
  assert.equal(r!.availabilityDate, "2026-11-17");
});

test("calculateExpectedAvailabilityDate: com feriado pula dia", () => {
  const r = calculateExpectedAvailabilityDate([2, 5], 2, date("2026-11-11"), false, ["2026-11-16"]);
  assert.ok(r);
  assert.equal(r!.availabilityDate, "2026-11-18");
});

// ── calculatePackagePurchase (R3.4 impl) ───────────────────────────────────
test("calculatePackagePurchase: 3 de 10 → 1 caixa, sobra 7", () => {
  const r = calculatePackagePurchase(3, 10, 0);
  assert.equal(r.packagesToBuy, 1);
  assert.equal(r.leftover, 7);
  assert.equal(r.unitsFromStock, 0);
});

test("calculatePackagePurchase: sobra existente cobre a demanda → 0 caixas", () => {
  const r = calculatePackagePurchase(3, 10, 5);
  assert.equal(r.packagesToBuy, 0);
  assert.equal(r.leftover, 0);
  assert.equal(r.unitsFromStock, 3);
});

test("calculatePackagePurchase: sobra parcial reduz compra", () => {
  const r = calculatePackagePurchase(12, 10, 5);
  // efetivo = 12 - 5 = 7 → 1 caixa → sobra 3
  assert.equal(r.packagesToBuy, 1);
  assert.equal(r.totalUnits, 10);
  assert.equal(r.leftover, 3);
  assert.equal(r.unitsFromStock, 5);
});

// ── checkPriceChangeLimit (R5 impl) ────────────────────────────────────────
test("checkPriceChangeLimit: redução sempre permitida", () => {
  const r = checkPriceChangeLimit(1000, 500, 8);
  assert.equal(r.allowed, true);
  assert.equal(r.isReduction, true);
});

test("checkPriceChangeLimit: +8% exato com limite 8% = permitido", () => {
  const r = checkPriceChangeLimit(1000, 1080, 8);
  assert.equal(r.allowed, true);
  assert.equal(r.changePct, 8);
});

test("checkPriceChangeLimit: +9% com limite 8% = bloqueado", () => {
  const r = checkPriceChangeLimit(1000, 1090, 8);
  assert.equal(r.allowed, false);
});

test("checkPriceChangeLimit: limite null = sempre permitido", () => {
  const r = checkPriceChangeLimit(1000, 2000, null);
  assert.equal(r.allowed, true);
});

// ── calculateBoxPrice (R3.2 impl) ──────────────────────────────────────────
test("calculateBoxPrice: 9.9 × 10 com 10% off = R$ 89.10", () => {
  assert.equal(calculateBoxPrice(9.9, 10, 10), 89.1);
});

test("calculateBoxPrice: sem desconto", () => {
  assert.equal(calculateBoxPrice(9.9, 10, 0), 99);
});

test("calculateBoxPrice: arredondamento correto com centavos", () => {
  // 5.35 × 6 = 32.10 (but JS float: 32.099...), × 0.85 = 27.284... → R$ 27.28
  assert.equal(calculateBoxPrice(5.35, 6, 15), 27.28);
});
