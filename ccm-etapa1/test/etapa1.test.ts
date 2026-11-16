// Testes = exemplos do documento da Etapa 1. Se algum falhar, não está como foi definido.
// Rodar:  node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarFornecedor, normalizarProduto, custoUnitario, modosPermitidos, validarModoVenda,
  opcoesNoSite, compraParaUnidades, proximoDiaPedido, dataDisponivelCd, avaliarPedidoMinimo,
  avaliarMudancaPreco, trocarFornecedor, linhasRelatorioDiario, registrarAlteracao,
} from "../src/regras.ts";
import type { Fornecedor, ProdutoFornecedor, ConfigSecao, ConfigGeral, Usuario } from "../src/tipos.ts";

const tambasa: Fornecedor = {
  id: "f1", nome: "Tambasa", pedidoMinimoTipo: "valor", pedidoMinimo: 500,
  diasPedido: ["terca", "sexta"], prazoEntregaCdDias: 2,
  freteTipo: "gratis_acima", freteGratisAcima: 1000, freteValor: 60,
};
const geral: ConfigGeral = { tetoSobraValor: 2000, horarioCorteCiclo: "12:00", feriados: [] };
const eletrica: ConfigSecao = { secao: "Elétrica", regraPreco: c => c * 1.6, limiteAumentoPct: 8, descontoCaixaPct: 10 };
const direcao: Usuario = { id: "u1", nome: "Rodrigo", permissaoDirecao: true };
const operador: Usuario = { id: "u2", nome: "Operador", permissaoDirecao: false };

const tomada: ProdutoFornecedor = {
  id: "pf1", fornecedorId: "f1", produtoId: "p-tomada", descricao: "Tomada 2P+T 10A branca",
  custo: 62, unidadeCompra: "caixa", qtdPorEmbalagem: 10, vendeAvulso: false, estoque: 34,
};
const fita: ProdutoFornecedor = { ...tomada, id: "pf2", produtoId: "p-fita", descricao: "Fita isolante 20 m" };

// R1
test("R1.1 fornecedor completo pode ativar", () => assert.deepEqual(validarFornecedor(tambasa), []));
test("R1.1 sem dias de pedido NÃO ativa", () =>
  assert.ok(validarFornecedor({ ...tambasa, diasPedido: [] }).includes("dias de pedido obrigatórios")));

// R2
test("R2.2 caixa com 10 a R$ 62,00 → R$ 6,20 por unidade", () => assert.equal(custoUnitario(tomada), 6.2));
test("R2.1 unidade força qtd 1 e venda avulsa", () => {
  const p = normalizarProduto({ ...tomada, unidadeCompra: "unidade", qtdPorEmbalagem: 5, vendeAvulso: false });
  assert.equal(p.qtdPorEmbalagem, 1); assert.equal(p.vendeAvulso, true);
});

// R3
test("R3 produto que não vende avulso não pode ser por_unidade", () =>
  assert.ok(!modosPermitidos(tomada).includes("por_unidade")));
test("R3.1 só a direção ativa unidade_e_caixa", () => {
  assert.equal(validarModoVenda(fita, "unidade_e_caixa", operador, geral, 0).ok, false);
  assert.equal(validarModoVenda(fita, "unidade_e_caixa", direcao, geral, 0).ok, true);
});
test("R3.3 teto de sobra atingido bloqueia unidade_e_caixa", () =>
  assert.equal(validarModoVenda(fita, "unidade_e_caixa", direcao, geral, 2000).ok, false));
test("R3.2 site: 1 un. R$ 9,90 e Caixa com 10 R$ 89,10 (10% off)", () => {
  const o = opcoesNoSite(fita, "unidade_e_caixa", 9.9, eletrica);
  assert.equal(o[0].preco, 9.9);
  assert.equal(o[1].preco, 89.1);
  assert.equal(o[1].rotulo, "Caixa com 10 un. (10% off)");
});
test("R3.4 cliente compra 3 un. → 1 caixa, sobra 7", () => assert.deepEqual(compraParaUnidades(3, 10), { embalagens: 1, sobra: 7 }));
test("R3.4 borda: 12 un. → 2 caixas, sobra 8", () => assert.deepEqual(compraParaUnidades(12, 10), { embalagens: 2, sobra: 8 }));

// R4
test("R4.2 venda na quarta → pedido sexta → disponível no CD terça", () => {
  assert.equal(proximoDiaPedido(tambasa, "2026-11-11T10:00", geral), "2026-11-13");
  assert.equal(dataDisponivelCd(tambasa, "2026-11-11T10:00", geral), "2026-11-17");
});
test("R4.1 borda: venda na sexta depois do corte → ciclo de terça", () => {
  assert.equal(proximoDiaPedido(tambasa, "2026-11-13T15:00", geral), "2026-11-17");
  assert.equal(dataDisponivelCd(tambasa, "2026-11-13T15:00", geral), "2026-11-19");
});
test("R4.1 venda na sexta antes do corte entra no pedido do mesmo dia", () =>
  assert.equal(proximoDiaPedido(tambasa, "2026-11-13T09:00", geral), "2026-11-13"));
test("R4.2 feriado não conta como dia útil", () =>
  assert.equal(dataDisponivelCd(tambasa, "2026-11-11T10:00", { ...geral, feriados: ["2026-11-16"] }), "2026-11-18"));
test("R4.3 R$ 380 de R$ 500 → não envia e notifica com 3 opções", () => {
  const r = avaliarPedidoMinimo(tambasa, 380, 0);
  assert.equal(r.acao, "notificar");
  if (r.acao === "notificar") {
    assert.equal(r.mensagem, "Tambasa: R$ 380,00 de R$ 500,00");
    assert.equal(r.opcoes.length, 3);
  }
});
test("R4.3 mínimo atingido → envia", () => assert.equal(avaliarPedidoMinimo(tambasa, 500, 0).acao, "enviar"));

// R5
test("R5.3 +6,4% com limite 8% → muda sozinho", () =>
  assert.equal(avaliarMudancaPreco("Disjuntor", 24.9, 26.5, eletrica).acao, "aplicar"));
test("R5.4 +13,8% com limite 8% → não muda e notifica", () => {
  const r = avaliarMudancaPreco("Ventilador Fame 130W", 289, 329, eletrica);
  assert.equal(r.acao, "notificar");
  if (r.acao === "notificar") {
    assert.equal(r.precoMantido, 289);
    assert.equal(r.mensagem, "Ventilador Fame 130W: preço subiria de R$ 289,00 para R$ 329,00 (+13,8%).");
    assert.deepEqual(r.opcoes, ["Aprovar", "Tirar da venda"]);
  }
});
test("R5.3 borda: exatamente 8% → muda sozinho", () =>
  assert.equal(avaliarMudancaPreco("X", 100, 108, eletrica).acao, "aplicar"));
test("R5.5 redução sempre muda sozinha", () =>
  assert.equal(avaliarMudancaPreco("X", 100, 50, eletrica).acao, "aplicar"));

// R6
test("R6 troca sozinho, registro só interno e linha no relatório", () => {
  const vent: ProdutoFornecedor = { ...tomada, id: "a", produtoId: "p-vent", descricao: "Ventilador Fame 130W",
    unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true, custo: 180, estoque: 0 };
  const b = { ...vent, id: "b", fornecedorId: "f2", custo: 188, estoque: 5 };
  const c = { ...vent, id: "c", fornecedorId: "f3", custo: 175, estoque: 0 };      // sem estoque: não serve
  const t = trocarFornecedor(vent, [b, c], "sem estoque", "2026-11-06T14:32:00");
  assert.equal(t.fornecedorNovoId, "f2");
  assert.equal(t.textoFicha, "06/11 14:32 — perdeu Ventilador Fame 130W: sem estoque");
  assert.deepEqual(linhasRelatorioDiario([t], { f1: "Tambasa", f2: "Fornecedor B" }),
    ["Ventilador Fame 130W · Tambasa → Fornecedor B · sem estoque · 14:32"]);
});
test("R6 nenhum outro fornecedor com estoque → registra SEM FORNECEDOR", () => {
  const t = trocarFornecedor({ ...tomada, estoque: 0 }, [], "sem estoque", "2026-11-06T09:00:00");
  assert.equal(t.fornecedorNovoId, null);
});

// Configuração
test("Alteração de configuração grava quem, quando e valor anterior", () => {
  const a = registrarAlteracao("u1", "Elétrica.limiteAumentoPct", 8, 10, "2026-11-11T10:00:00");
  assert.deepEqual(a, { usuarioId: "u1", quando: "2026-11-11T10:00:00", chave: "Elétrica.limiteAumentoPct", valorAnterior: 8, valorNovo: 10 });
});
