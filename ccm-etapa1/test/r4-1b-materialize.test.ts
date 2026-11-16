import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { materializarVendas } from "../src/regras.ts";
import type { Fornecedor, ConfigGeral, ItemVendido } from "../src/tipos.ts";

// ─── Fixtures ───

const geral: ConfigGeral = {
  tetoSobraValor: 5000,
  horarioCorteCiclo: "17:30",
  feriados: [],
};

function makeSupplier(overrides: Partial<Fornecedor> & { id: string }): Fornecedor {
  return {
    nome: "Forn " + overrides.id,
    pedidoMinimoTipo: "valor",
    pedidoMinimo: 500,
    diasPedido: ["segunda", "quarta", "sexta"],
    prazoEntregaCdDias: 2,
    freteTipo: "fixo",
    freteValor: 50,
    ...overrides,
  };
}

const supplierA = makeSupplier({ id: "SA" });
const supplierB = makeSupplier({ id: "SB", diasPedido: ["terca", "quinta"] });

function makeFornecedores(...suppliers: Fornecedor[]): Map<string, Fornecedor> {
  const m = new Map<string, Fornecedor>();
  for (const s of suppliers) m.set(s.id, s);
  return m;
}

function makeItem(overrides: Partial<ItemVendido> & { itemId: string; supplierId: string }): ItemVendido {
  return {
    masterProductId: "MP1",
    supplierCostCentavos: 620,
    qty: 3,
    qtdPorEmbalagem: 10,
    unidadeCompra: "caixa",
    packCostCentavos: 6200,
    ...overrides,
  };
}

// ─── Tests ───

describe("R4.1b — materializarVendas", () => {

  // A: Venda paga antes do cutoff → requirement no ciclo do mesmo dia
  it("A: venda antes do cutoff em dia de pedido → ciclo do mesmo dia", () => {
    // 2026-11-13 (sexta) às 17:29 — sexta é dia de pedido de supplierA
    const reqs = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-13T17:29",
      geral,
    );
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].cycleDate, "2026-11-13"); // sexta = mesmo dia
    assert.equal(reqs[0].qty, 3);
  });

  // B: Venda exatamente 17:30 → próximo ciclo
  it("B: venda exatamente no cutoff 17:30 → próximo ciclo", () => {
    // 2026-11-13 (sexta) às 17:30 — cutoff atingido → próximo dia de pedido
    const reqs = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-13T17:30",
      geral,
    );
    assert.equal(reqs.length, 1);
    // Sexta 17:30 → próximo dia de pedido = segunda 2026-11-16
    assert.equal(reqs[0].cycleDate, "2026-11-16");
  });

  // C: Duas vendas do mesmo produto/supplier/ciclo → acumulam
  it("C: duas vendas mesmo supplier/produto/ciclo acumulam no mesmo requirement", () => {
    const reqs = materializarVendas(
      [
        makeItem({ itemId: "i1", supplierId: "SA", masterProductId: "MP1", qty: 3 }),
        makeItem({ itemId: "i2", supplierId: "SA", masterProductId: "MP1", qty: 5 }),
      ],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geral,
    );
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].qty, 8); // 3 + 5
    assert.deepEqual(reqs[0].sourceItemIds, ["i1", "i2"]);
  });

  // D: Dois suppliers no mesmo pedido → requirements separados
  it("D: dois suppliers → requirements separados", () => {
    const reqs = materializarVendas(
      [
        makeItem({ itemId: "i1", supplierId: "SA", masterProductId: "MP1" }),
        makeItem({ itemId: "i2", supplierId: "SB", masterProductId: "MP2" }),
      ],
      makeFornecedores(supplierA, supplierB),
      "2026-11-13T10:00", // sexta
      geral,
    );
    assert.equal(reqs.length, 2);
    const reqA = reqs.find(r => r.supplierId === "SA")!;
    const reqB = reqs.find(r => r.supplierId === "SB")!;
    assert.ok(reqA);
    assert.ok(reqB);
    // SupplierA: sexta é dia de pedido → 2026-11-13
    assert.equal(reqA.cycleDate, "2026-11-13");
    // SupplierB: dias = ter/qui → próximo = qui 2026-11-19... wait
    // Sexta 13/11 → próx terca = 18/11? Let me check:
    // 13/11 sexta → 14 sab, 15 dom, 16 seg, 17 ter. Ter é dia de pedido de SB
    assert.equal(reqB.cycleDate, "2026-11-17");
  });

  // E: Item sem supplier → ignorado (não gera requirement)
  it("E: item sem supplier no mapa → ignorado", () => {
    const reqs = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "UNKNOWN" })],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geral,
    );
    assert.equal(reqs.length, 0);
  });

  // F: Pedido não pago → NÃO cria requirement (testado pela ausência de chamada)
  it("F: lista vazia de itens → nenhum requirement", () => {
    const reqs = materializarVendas(
      [],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geral,
    );
    assert.equal(reqs.length, 0);
  });

  // G: Feriado → cycle_date correto
  it("G: feriado não afeta cycle_date (afeta só disponibilidade via dataDisponivelCd)", () => {
    // cycle_date é o dia de pedido, não depende de feriados diretamente
    // Feriados afetam a contagem de dias úteis em dataDisponivelCd, não o cycle_date
    const geralComFeriado: ConfigGeral = {
      ...geral,
      feriados: ["2026-11-13"], // sexta é feriado
    };
    const reqs = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geralComFeriado,
    );
    assert.equal(reqs.length, 1);
    // cycle_date NÃO pula feriados — é o dia de pedido do fornecedor
    // (feriado afeta add_business_days para data de disponibilidade, não o dia do ciclo)
    assert.equal(reqs[0].cycleDate, "2026-11-13");
  });

  // H: Snapshot preservado — trocar sourcing não muda requirement
  it("H: snapshot preserva custo e offer do item vendido", () => {
    const item = makeItem({
      itemId: "i1",
      supplierId: "SA",
      supplierCostCentavos: 620,
      packCostCentavos: 6200,
      qtdPorEmbalagem: 10,
      unidadeCompra: "caixa",
    });
    const reqs = materializarVendas(
      [item],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geral,
    );
    assert.equal(reqs[0].unitCostCentavos, 620);
    assert.equal(reqs[0].packCostCentavos, 6200);
    assert.equal(reqs[0].qtdPorEmbalagem, 10);
    assert.equal(reqs[0].unidadeCompra, "caixa");
  });

  // Acumulação com produtos diferentes do mesmo supplier → separados
  it("mesmo supplier, produtos diferentes → requirements separados", () => {
    const reqs = materializarVendas(
      [
        makeItem({ itemId: "i1", supplierId: "SA", masterProductId: "MP1", qty: 2 }),
        makeItem({ itemId: "i2", supplierId: "SA", masterProductId: "MP2", qty: 4 }),
      ],
      makeFornecedores(supplierA),
      "2026-11-13T10:00",
      geral,
    );
    assert.equal(reqs.length, 2);
    const r1 = reqs.find(r => r.masterProductId === "MP1")!;
    const r2 = reqs.find(r => r.masterProductId === "MP2")!;
    assert.equal(r1.qty, 2);
    assert.equal(r2.qty, 4);
  });

  // Venda em dia que NÃO é dia de pedido → próximo dia de pedido
  it("venda em dia não-pedido → próximo dia de pedido", () => {
    // 2026-11-12 (quinta) — supplierA tem seg/qua/sex
    const reqs = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-12T10:00",
      geral,
    );
    assert.equal(reqs.length, 1);
    // Quinta 12 → próximo dia = sexta 13
    assert.equal(reqs[0].cycleDate, "2026-11-13");
  });

  // Cutoff configurável
  it("cutoff 16:00: venda 15:59 entra no mesmo dia, 16:00 vai para próximo", () => {
    const geralCorte16: ConfigGeral = { ...geral, horarioCorteCiclo: "16:00" };
    const antes = materializarVendas(
      [makeItem({ itemId: "i1", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-13T15:59",
      geralCorte16,
    );
    assert.equal(antes[0].cycleDate, "2026-11-13");

    const depois = materializarVendas(
      [makeItem({ itemId: "i2", supplierId: "SA" })],
      makeFornecedores(supplierA),
      "2026-11-13T16:00",
      geralCorte16,
    );
    assert.equal(depois[0].cycleDate, "2026-11-16"); // próximo = segunda
  });
});
