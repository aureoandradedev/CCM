// Testes adicionais: regras da Etapa 1 não cobertas pelos 23 testes de referência.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarFornecedor, normalizarProduto, custoUnitario, modosPermitidos, validarModoVenda,
  opcoesNoSite, compraParaUnidades, proximoDiaPedido, dataDisponivelCd, avaliarPedidoMinimo,
  precoVenda, avaliarMudancaPreco, trocarFornecedor, linhasRelatorioDiario, registrarAlteracao,
} from "../src/regras.ts";
import type { Fornecedor, ProdutoFornecedor, ConfigSecao, ConfigGeral, Usuario } from "../src/tipos.ts";

const tambasa: Fornecedor = {
  id: "f1", nome: "Tambasa", pedidoMinimoTipo: "valor", pedidoMinimo: 500,
  diasPedido: ["terca", "sexta"], prazoEntregaCdDias: 2,
  freteTipo: "gratis_acima", freteGratisAcima: 1000, freteValor: 60,
};
const geral: ConfigGeral = { tetoSobraValor: 2000, horarioCorteCiclo: "17:30", feriados: [] };
const eletrica: ConfigSecao = { secao: "Elétrica", regraPreco: c => c * 1.6, limiteAumentoPct: 8, descontoCaixaPct: 10 };
const direcao: Usuario = { id: "u1", nome: "Rodrigo", permissaoDirecao: true };

const tomada: ProdutoFornecedor = {
  id: "pf1", fornecedorId: "f1", produtoId: "p-tomada", descricao: "Tomada 2P+T 10A branca",
  custo: 62, unidadeCompra: "caixa", qtdPorEmbalagem: 10, vendeAvulso: false, estoque: 34,
};

// ── R5.1: precoVenda = regraPreco(custoUnitario) ───────────────────────────
test("R5.1 precoVenda aplica regra da seção ao custo unitário", () => {
  // custo 62, qtd 10 → custoUnitário 6.20 → 6.20 × 1.6 = 9.92
  assert.equal(precoVenda(tomada, eletrica), 9.92);
});

test("R5.1 precoVenda com unidade de compra 'unidade' (qtd=1)", () => {
  const prod: ProdutoFornecedor = {
    ...tomada, unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true, custo: 15,
  };
  const norm = normalizarProduto(prod);
  // custoUnitário = 15/1 = 15, preço = 15 × 1.6 = 24
  assert.equal(precoVenda(norm, eletrica), 24);
});

// ── R3: modos de venda — por_unidade, embalagem_fechada, nao_vender ────────
test("R3 produto avulso: modos permitidos = [por_unidade, nao_vender]", () => {
  const avulso: ProdutoFornecedor = { ...tomada, vendeAvulso: true };
  assert.deepEqual(modosPermitidos(avulso), ["por_unidade", "nao_vender"]);
});

test("R3 produto não-avulso: modos permitidos = [embalagem_fechada, unidade_e_caixa, nao_vender]", () => {
  assert.deepEqual(modosPermitidos(tomada), ["embalagem_fechada", "unidade_e_caixa", "nao_vender"]);
});

test("R3 site embalagem_fechada: caixa inteira sem desconto", () => {
  const opts = opcoesNoSite(tomada, "embalagem_fechada", 9.9, eletrica);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].quantidade, 10);
  assert.equal(opts[0].preco, 99); // 9.9 × 10
  assert.ok(opts[0].rotulo.includes("Caixa com 10"));
});

test("R3 site por_unidade: 1 un. ao preço unitário", () => {
  const avulso: ProdutoFornecedor = { ...tomada, vendeAvulso: true };
  const opts = opcoesNoSite(avulso, "por_unidade", 9.9, eletrica);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].quantidade, 1);
  assert.equal(opts[0].preco, 9.9);
});

test("R3 site nao_vender: nenhuma opção", () => {
  const opts = opcoesNoSite(tomada, "nao_vender", 9.9, eletrica);
  assert.equal(opts.length, 0);
});

// ── R3.4 sobra: consume existing leftover ─────────────────────────────────
test("R3.4 sobra: cliente compra exatamente 10 un. de caixa com 10 → 0 sobra", () => {
  const r = compraParaUnidades(10, 10);
  assert.equal(r.embalagens, 1);
  assert.equal(r.sobra, 0);
});

test("R3.4 sobra: cliente compra 1 un. de caixa com 10 → 1 embalagem, sobra 9", () => {
  const r = compraParaUnidades(1, 10);
  assert.equal(r.embalagens, 1);
  assert.equal(r.sobra, 9);
});

// ── R4.1 cutoff: 17:29 mesmo ciclo, 17:30 próximo ─────────────────────────
test("R4.1 cutoff 17:30: venda às 17:29 no dia de pedido entra no mesmo ciclo", () => {
  assert.equal(proximoDiaPedido(tambasa, "2026-11-13T17:29", geral), "2026-11-13");
});

test("R4.1 cutoff 17:30: venda às 17:30 no dia de pedido vai para o próximo ciclo", () => {
  assert.equal(proximoDiaPedido(tambasa, "2026-11-13T17:30", geral), "2026-11-17");
});

test("R4.1 cutoff 17:30: venda às 17:31 no dia de pedido vai para o próximo ciclo", () => {
  assert.equal(proximoDiaPedido(tambasa, "2026-11-13T17:31", geral), "2026-11-17");
});

// ── R4.2 feriados: múltiplos feriados consecutivos ─────────────────────────
test("R4.2 dois feriados consecutivos: pula ambos", () => {
  const geralFeriados: ConfigGeral = {
    ...geral,
    feriados: ["2026-11-16", "2026-11-17"], // seg e ter
  };
  // venda qua 11/11 → pedido sex 13 → +2 dias úteis com seg+ter feriado
  // sex 13 + dia1=seg(feriado, pula) + dia1=ter(feriado, pula) + dia1=qua = qua 18 (1 dia)
  // + dia2=qui 19
  assert.equal(dataDisponivelCd(tambasa, "2026-11-11T10:00", geralFeriados), "2026-11-19");
});

// ── R4.3 mínimo por volume ─────────────────────────────────────────────────
test("R4.3 mínimo por volume: 40 un. de 50 → não envia", () => {
  const fornVol: Fornecedor = { ...tambasa, pedidoMinimoTipo: "volume", pedidoMinimo: 50 };
  const r = avaliarPedidoMinimo(fornVol, 999, 40);
  assert.equal(r.acao, "notificar");
  if (r.acao === "notificar") {
    assert.ok(r.mensagem.includes("40 un."));
    assert.ok(r.mensagem.includes("50 un."));
    assert.equal(r.opcoes.length, 3);
    assert.ok(r.opcoes.includes("Completar pedido"));
    assert.ok(r.opcoes.includes("Enviar pagando a diferença/frete"));
    assert.ok(r.opcoes.includes("Esperar próximo ciclo"));
  }
});

test("R4.3 mínimo por volume atingido → envia", () => {
  const fornVol: Fornecedor = { ...tambasa, pedidoMinimoTipo: "volume", pedidoMinimo: 50 };
  assert.equal(avaliarPedidoMinimo(fornVol, 0, 50).acao, "enviar");
});

// ── R5.4 notificação com opções [Aprovar] e [Tirar da venda] ──────────────
test("R5.4 notificação inclui exatamente [Aprovar, Tirar da venda]", () => {
  const r = avaliarMudancaPreco("X", 100, 120, eletrica);
  assert.equal(r.acao, "notificar");
  if (r.acao === "notificar") {
    assert.deepEqual(r.opcoes, ["Aprovar", "Tirar da venda"]);
  }
});

// ── R6: menor custo unitário com estoque (NOT ranking ponderado) ───────────
test("R6 seleciona por menor custo unitário, não por estoque ou prazo", () => {
  const vent: ProdutoFornecedor = {
    ...tomada, id: "a", produtoId: "p-vent", descricao: "Ventilador",
    unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true,
    custo: 180, estoque: 0,
  };
  // f2: custo alto, mas MUITO estoque e prazo curto → ganharia no ranking ponderado
  const f2 = { ...vent, id: "b", fornecedorId: "f2", custo: 200, estoque: 1000 };
  // f3: custo MAIS BAIXO, pouco estoque → ganha pelo critério oficial
  const f3 = { ...vent, id: "c", fornecedorId: "f3", custo: 170, estoque: 2 };
  const t = trocarFornecedor(vent, [f2, f3], "sem estoque", "2026-11-06T14:00:00");
  assert.equal(t.fornecedorNovoId, "f3"); // f3 tem o menor custo unitário
});

test("R6 empate de custo unitário: ambos elegíveis, algum é escolhido (estável)", () => {
  const vent: ProdutoFornecedor = {
    ...tomada, id: "a", produtoId: "p-vent", descricao: "Vent",
    unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true,
    custo: 180, estoque: 0,
  };
  const f2 = { ...vent, id: "b", fornecedorId: "f2", custo: 175, estoque: 5 };
  const f3 = { ...vent, id: "c", fornecedorId: "f3", custo: 175, estoque: 3 };
  const t = trocarFornecedor(vent, [f2, f3], "sem estoque", "2026-11-06T14:00:00");
  assert.ok(t.fornecedorNovoId === "f2" || t.fornecedorNovoId === "f3");
});

// ── R6.3: troca com registro interno, fornecedor anterior na ficha ────────
test("R6 textoFicha contém data, hora, produto e motivo", () => {
  const vent: ProdutoFornecedor = {
    ...tomada, id: "a", produtoId: "p-vent", descricao: "Ventilador Fame 130W",
    unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true,
    custo: 180, estoque: 0,
  };
  const b = { ...vent, id: "b", fornecedorId: "f2", custo: 188, estoque: 5 };
  const t = trocarFornecedor(vent, [b], "fornecedor não entrega mais", "2026-11-06T09:15:00");
  assert.equal(t.textoFicha, "06/11 09:15 — perdeu Ventilador Fame 130W: fornecedor não entrega mais");
});

// ── R6.4: relatório diário ─────────────────────────────────────────────────
test("R6.4 relatório diário: múltiplas trocas", () => {
  const vent: ProdutoFornecedor = {
    ...tomada, id: "a", produtoId: "p-vent", descricao: "Vent",
    unidadeCompra: "unidade", qtdPorEmbalagem: 1, vendeAvulso: true,
    custo: 180, estoque: 0,
  };
  const b = { ...vent, id: "b", fornecedorId: "f2", custo: 188, estoque: 5 };
  const troca1 = trocarFornecedor(vent, [b], "sem estoque", "2026-11-06T09:00:00");
  const troca2 = trocarFornecedor({ ...vent, produtoId: "p-lamp", descricao: "Lâmpada" },
    [], "sem estoque", "2026-11-06T14:30:00");
  const linhas = linhasRelatorioDiario([troca1, troca2], { f1: "Tambasa", f2: "B" });
  assert.equal(linhas.length, 2);
  assert.ok(linhas[0].includes("Vent"));
  assert.ok(linhas[1].includes("SEM FORNECEDOR"));
});

// ── R1.1: validações de campos obrigatórios ────────────────────────────────
test("R1.1 frete gratis_acima sem valor → erro", () => {
  const f: Fornecedor = { ...tambasa, freteTipo: "gratis_acima", freteGratisAcima: 0 };
  assert.ok(validarFornecedor(f).includes("valor para frete grátis obrigatório"));
});

test("R1.1 sem nome → erro", () => {
  const f: Fornecedor = { ...tambasa, nome: "" };
  assert.ok(validarFornecedor(f).includes("nome obrigatório"));
});

// ── Configuração: auditoria de alteração ───────────────────────────────────
test("Alteração config: valores complexos (array → array)", () => {
  const a = registrarAlteracao("u1", "diasPedido", ["terca"], ["terca", "quinta"], "2026-11-12T09:00:00");
  assert.deepEqual(a.valorAnterior, ["terca"]);
  assert.deepEqual(a.valorNovo, ["terca", "quinta"]);
});
