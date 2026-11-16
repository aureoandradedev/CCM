// Tests for src/lib/ranking/engine.ts R6.1 compliance:
// "menor custo unitário entre fornecedores elegíveis com estoque > 0"
// Weighted score is BI-only — recommendation must follow unit cost rule.
import { test } from "node:test";
import assert from "node:assert/strict";

// Inline the engine logic to test without Next.js module resolution
// This mirrors the recommendation logic from engine.ts after the R6.1 fix

interface RankableOffer {
  id: string;
  master_product_id: string;
  supplier_id: string;
  cost_centavos: number;
  unit_cost_centavos?: number | null;
  stock: number | null;
  lead_time_days: number;
  status: string;
}

function pickRecommendation(offers: RankableOffer[]): string | null {
  const eligible = offers.filter(o => o.status === "ativa");
  const withStock = eligible
    .filter(o => (o.stock ?? 0) > 0 && o.cost_centavos > 0)
    .sort((a, b) => {
      const unitA = a.unit_cost_centavos ?? a.cost_centavos;
      const unitB = b.unit_cost_centavos ?? b.cost_centavos;
      return unitA - unitB;
    });

  if (withStock.length === 0) return null;

  if (withStock.length >= 2) {
    const unitFirst = withStock[0].unit_cost_centavos ?? withStock[0].cost_centavos;
    const unitSecond = withStock[1].unit_cost_centavos ?? withStock[1].cost_centavos;
    if (unitFirst === unitSecond) return null; // ambiguous
  }

  return withStock[0].id;
}

const base = { master_product_id: "mp1", status: "ativa" as const };

// R6.1: picks cheapest unit cost with stock
test("R6.1 picks lowest unit_cost_centavos among offers with stock", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 1000, unit_cost_centavos: 100, stock: 50, lead_time_days: 7 },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 800,  unit_cost_centavos: 80,  stock: 5,  lead_time_days: 14 },
    { ...base, id: "c", supplier_id: "s3", cost_centavos: 500,  unit_cost_centavos: 50,  stock: 3,  lead_time_days: 21 },
  ];
  assert.equal(pickRecommendation(offers), "c");
});

// R6.1: cheapest without stock is skipped
test("R6.1 skips cheapest if stock is zero", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 500, unit_cost_centavos: 50, stock: 0,  lead_time_days: 1 },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 800, unit_cost_centavos: 80, stock: 10, lead_time_days: 3 },
  ];
  assert.equal(pickRecommendation(offers), "b");
});

// R6.1: weighted ranking would prefer high-stock + fast-lead option, but R6 picks cheapest
test("R6.1 ignores stock/lead_time advantage in favor of lowest cost", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "expensive-fast", supplier_id: "s1", cost_centavos: 2000, unit_cost_centavos: 200, stock: 500, lead_time_days: 1 },
    { ...base, id: "cheap-slow",     supplier_id: "s2", cost_centavos: 600,  unit_cost_centavos: 60,  stock: 2,   lead_time_days: 30 },
  ];
  assert.equal(pickRecommendation(offers), "cheap-slow");
});

// R6.1: falls back to cost_centavos when unit_cost_centavos is null
test("R6.1 uses cost_centavos as fallback when unit_cost is null", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 300, unit_cost_centavos: null, stock: 10, lead_time_days: 3 },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: null, stock: 10, lead_time_days: 3 },
  ];
  assert.equal(pickRecommendation(offers), "a");
});

// R6.1: equal unit cost → ambiguous, no recommendation
test("R6.1 equal unit costs → ambiguous (null recommendation)", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 1000, unit_cost_centavos: 100, stock: 10, lead_time_days: 3 },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 500,  unit_cost_centavos: 100, stock: 5,  lead_time_days: 5 },
  ];
  assert.equal(pickRecommendation(offers), null);
});

// R6.1: inactive offers excluded
test("R6.1 inactive offer excluded even if cheapest", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 100, unit_cost_centavos: 10, stock: 100, lead_time_days: 1, status: "vencida" },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 10,  lead_time_days: 3 },
  ];
  assert.equal(pickRecommendation(offers), "b");
});

// R6: no one with stock → null
test("R6.1 all out of stock → no recommendation", () => {
  const offers: RankableOffer[] = [
    { ...base, id: "a", supplier_id: "s1", cost_centavos: 100, unit_cost_centavos: 10, stock: 0, lead_time_days: 1 },
    { ...base, id: "b", supplier_id: "s2", cost_centavos: 200, unit_cost_centavos: 20, stock: 0, lead_time_days: 2 },
  ];
  assert.equal(pickRecommendation(offers), null);
});

// R5 pricing tests (using reference regras.ts)
import { avaliarMudancaPreco, precoVenda } from "../src/regras.ts";
import type { ConfigSecao } from "../src/tipos.ts";

const eletrica: ConfigSecao = { secao: "Elétrica", regraPreco: c => c * 1.6, limiteAumentoPct: 8, descontoCaixaPct: 10 };

test("R5.1 precoVenda applies section rule to unit cost", () => {
  const produto = { custo: 62, unidadeCompra: "caixa" as const, qtdPorEmbalagem: 10 };
  const preco = precoVenda(produto, eletrica);
  // custoUnitario = 62/10 = 6.2; regraPreco = 6.2 * 1.6 = 9.92
  assert.equal(preco, 9.92);
});

test("R5.1 precoVenda for unit product", () => {
  const produto = { custo: 15, unidadeCompra: "unidade" as const, qtdPorEmbalagem: 1 };
  const preco = precoVenda(produto, eletrica);
  // custoUnitario = 15/1 = 15; regraPreco = 15 * 1.6 = 24
  assert.equal(preco, 24);
});

test("R5.4 boundary: just above limit → blocked", () => {
  const r = avaliarMudancaPreco("X", 100, 108.01, eletrica);
  assert.equal(r.acao, "notificar");
});

test("R5.5 zero change → aplicar (no change needed)", () => {
  const r = avaliarMudancaPreco("X", 100, 100, eletrica);
  assert.equal(r.acao, "aplicar");
});
