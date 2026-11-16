// CCM — Etapa 1: regras de negócio (puras, sem banco de dados nem tela).
// O programador encaixa estas funções no sistema; as telas e a gravação ficam com ele.

import type {
  Fornecedor, ProdutoFornecedor, ModoVenda, ConfigSecao, ConfigGeral,
  Usuario, AlteracaoConfig, DiaSemana, ItemVendido, RequirementGerado,
} from "./tipos.ts";

const r2 = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────── R1 — Fornecedor ─────────────────────────

/** R1.1 — retorna a lista de problemas; vazia = pode ativar. */
export function validarFornecedor(f: Fornecedor): string[] {
  const erros: string[] = [];
  if (!f.nome?.trim()) erros.push("nome obrigatório");
  if (!(f.pedidoMinimo >= 0)) erros.push("pedido mínimo obrigatório");
  if (!f.diasPedido?.length) erros.push("dias de pedido obrigatórios");
  if (!(f.prazoEntregaCdDias >= 0)) erros.push("prazo de entrega no CD obrigatório");
  if (f.freteTipo === "gratis_acima" && !(Number(f.freteGratisAcima) > 0))
    erros.push("valor para frete grátis obrigatório");
  if (!(f.freteValor >= 0)) erros.push("valor do frete obrigatório");
  return erros;
}

// ───────────────────────── R2 — Produto do fornecedor ─────────────────────────

/** R2.1 — unidade de compra "unidade" força qtd 1 e venda avulsa. */
export function normalizarProduto(p: ProdutoFornecedor): ProdutoFornecedor {
  if (p.unidadeCompra === "unidade") return { ...p, qtdPorEmbalagem: 1, vendeAvulso: true };
  return p;
}

/** R2.2 — custo da unidade avulsa = custo ÷ quantidade por embalagem. */
export function custoUnitario(p: ProdutoFornecedor): number {
  const q = p.qtdPorEmbalagem > 0 ? p.qtdPorEmbalagem : 1;
  return r2(p.custo / q);
}

// ───────────────────────── R3 — Modo de venda ─────────────────────────

/** Modos permitidos para o produto, conforme vende_avulso. */
export function modosPermitidos(p: ProdutoFornecedor): ModoVenda[] {
  return p.vendeAvulso
    ? ["por_unidade", "nao_vender"]
    : ["embalagem_fechada", "unidade_e_caixa", "nao_vender"];
}

/**
 * R3.1 + R3.3 — valida a ativação de um modo.
 * sobraAtualValor = valor (R$) já parado em sobra em toda a CCM.
 */
export function validarModoVenda(
  p: ProdutoFornecedor, modo: ModoVenda, usuario: Usuario,
  geral: ConfigGeral, sobraAtualValor: number,
): { ok: true } | { ok: false; motivo: string } {
  if (!modosPermitidos(p).includes(modo))
    return { ok: false, motivo: `modo ${modo} não permitido para este produto` };
  if (modo === "unidade_e_caixa") {
    if (!usuario.permissaoDirecao) return { ok: false, motivo: "somente a direção ativa Unidade + caixa" };
    if (sobraAtualValor >= geral.tetoSobraValor) return { ok: false, motivo: "teto de sobra atingido" };
  }
  return { ok: true };
}

export interface OpcaoSite { rotulo: string; quantidade: number; preco: number; }

/**
 * O que o cliente vê no site (R3 + R3.2).
 * precoUnitario = preço de venda de 1 unidade (vem de R5).
 */
export function opcoesNoSite(
  p: ProdutoFornecedor, modo: ModoVenda, precoUnitario: number, secao: ConfigSecao,
): OpcaoSite[] {
  const q = p.qtdPorEmbalagem;
  const nomeEmb = p.unidadeCompra;
  const caixaCheia = r2(precoUnitario * q);
  switch (modo) {
    case "por_unidade":
      return [{ rotulo: "1 un.", quantidade: 1, preco: r2(precoUnitario) }];
    case "embalagem_fechada":
      return [{ rotulo: `${cap(nomeEmb)} com ${q} un.`, quantidade: q, preco: caixaCheia }];
    case "unidade_e_caixa":
      return [
        { rotulo: "1 un.", quantidade: 1, preco: r2(precoUnitario) },
        { rotulo: `${cap(nomeEmb)} com ${q} un. (${secao.descontoCaixaPct}% off)`, quantidade: q,
          preco: r2(caixaCheia * (1 - secao.descontoCaixaPct / 100)) },
      ];
    case "nao_vender":
      return [];
  }
}

/** R3.4 — quantas embalagens comprar para atender N unidades e quanto sobra. */
export function compraParaUnidades(unidadesVendidas: number, qtdPorEmbalagem: number) {
  const embalagens = Math.ceil(unidadesVendidas / qtdPorEmbalagem);
  return { embalagens, sobra: embalagens * qtdPorEmbalagem - unidadesVendidas };
}

// ───────────────────────── R4 — Compra por ciclo ─────────────────────────

const DIAS: DiaSemana[] = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

function ehDiaUtil(d: Date, geral: ConfigGeral): boolean {
  const ds = d.getUTCDay();
  return ds !== 0 && ds !== 6 && !geral.feriados.includes(iso(d));
}

/**
 * R4.1 — data do pedido de compra em que entra uma venda.
 * `momentoVenda` em horário local da loja, formato "AAAA-MM-DDTHH:MM".
 * Venda em dia de pedido depois do horário de corte vai para o próximo dia de pedido.
 */
export function proximoDiaPedido(f: Fornecedor, momentoVenda: string, geral: ConfigGeral): string {
  const [data, hora = "00:00"] = momentoVenda.split("T");
  let d = new Date(data + "T00:00:00Z");
  const hojeEhDiaPedido = f.diasPedido.includes(DIAS[d.getUTCDay()]);
  if (hojeEhDiaPedido && hora < geral.horarioCorteCiclo) return iso(d);
  for (let i = 1; i <= 14; i++) {
    d = addDias(d, 1);
    if (f.diasPedido.includes(DIAS[d.getUTCDay()])) return iso(d);
  }
  throw new Error("fornecedor sem dias de pedido");
}

/** R4.2 — data em que o produto fica disponível no CD (dia do pedido + N dias úteis). */
export function dataDisponivelCd(f: Fornecedor, momentoVenda: string, geral: ConfigGeral): string {
  let d = new Date(proximoDiaPedido(f, momentoVenda, geral) + "T00:00:00Z");
  let n = f.prazoEntregaCdDias;
  while (n > 0) { d = addDias(d, 1); if (ehDiaUtil(d, geral)) n--; }
  return iso(d);
}

/** R4.3 — decide se o pedido do ciclo pode ser enviado. */
export function avaliarPedidoMinimo(
  f: Fornecedor, totalValor: number, totalVolume: number,
): { acao: "enviar" } | { acao: "notificar"; mensagem: string; opcoes: string[] } {
  const atual = f.pedidoMinimoTipo === "valor" ? totalValor : totalVolume;
  if (atual >= f.pedidoMinimo) return { acao: "enviar" };
  const fmt = (v: number) => f.pedidoMinimoTipo === "valor" ? brl(v) : `${v} un.`;
  return {
    acao: "notificar",
    mensagem: `${f.nome}: ${fmt(atual)} de ${fmt(f.pedidoMinimo)}`,
    opcoes: ["Completar pedido", "Enviar pagando a diferença/frete", "Esperar próximo ciclo"],
  };
}

// ───────────────────────── R5 — Preço ─────────────────────────

/** R5.1 — preço de venda de 1 unidade. */
export function precoVenda(p: ProdutoFornecedor, secao: ConfigSecao): number {
  return r2(secao.regraPreco(custoUnitario(p)));
}

export type DecisaoPreco =
  | { acao: "aplicar"; precoNovo: number; variacaoPct: number }
  | { acao: "notificar"; precoMantido: number; precoProposto: number; variacaoPct: number; mensagem: string; opcoes: string[] };

/** R5.3 / R5.4 / R5.5 — decide se o novo preço entra sozinho. */
export function avaliarMudancaPreco(
  nomeProduto: string, precoAtual: number, precoNovo: number, secao: ConfigSecao,
): DecisaoPreco {
  const variacaoPct = r2(((precoNovo - precoAtual) / precoAtual) * 100);
  if (precoNovo <= precoAtual || variacaoPct <= secao.limiteAumentoPct)
    return { acao: "aplicar", precoNovo: r2(precoNovo), variacaoPct };
  return {
    acao: "notificar", precoMantido: precoAtual, precoProposto: r2(precoNovo), variacaoPct,
    mensagem: `${nomeProduto}: preço subiria de ${brl(precoAtual)} para ${brl(precoNovo)} (+${fmtPct(variacaoPct)}).`,
    opcoes: ["Aprovar", "Tirar da venda"],
  };
}

// ───────────────────────── R6 — Troca de fornecedor ─────────────────────────

export interface RegistroTroca {
  produtoId: string;
  descricao: string;
  fornecedorAnteriorId: string;
  fornecedorNovoId: string | null;   // null = nenhum fornecedor disponível
  motivo: string;
  quando: string;                    // ISO
  textoFicha: string;                // vai só para a ficha interna do fornecedor anterior
}

/**
 * R6.1 / R6.2 — quando o fornecedor ativo perde o produto, escolhe outro que tenha o mesmo produto.
 * Critério de escolha entre os candidatos: menor custo por unidade com estoque.
 * (Critério de desempate a confirmar com o Rodrigo; isolado aqui para trocar fácil.)
 * Nenhuma mensagem é enviada ao fornecedor: o retorno é só registro interno.
 */
export function trocarFornecedor(
  ativo: ProdutoFornecedor, candidatos: ProdutoFornecedor[], motivo: string, quando: string,
): RegistroTroca {
  const novo = candidatos
    .filter(c => c.produtoId === ativo.produtoId && c.fornecedorId !== ativo.fornecedorId && c.estoque > 0)
    .sort((a, b) => custoUnitario(a) - custoUnitario(b))[0];
  const hora = quando.slice(11, 16);
  const dia = `${quando.slice(8, 10)}/${quando.slice(5, 7)}`;
  return {
    produtoId: ativo.produtoId, descricao: ativo.descricao,
    fornecedorAnteriorId: ativo.fornecedorId, fornecedorNovoId: novo ? novo.fornecedorId : null,
    motivo, quando,
    textoFicha: `${dia} ${hora} — perdeu ${ativo.descricao}: ${motivo}`,
  };
}

/** R6.4 — linhas do relatório do fim do dia. */
export function linhasRelatorioDiario(trocas: RegistroTroca[], nomes: Record<string, string>): string[] {
  return trocas.map(t =>
    `${t.descricao} · ${nomes[t.fornecedorAnteriorId]} → ${t.fornecedorNovoId ? nomes[t.fornecedorNovoId] : "SEM FORNECEDOR"} · ${t.motivo} · ${t.quando.slice(11, 16)}`);
}

// ───────────────────────── R4.1b — Materializar vendas → requirements ─────────────────────────

/**
 * R4.1b — materializa itens de venda paga em purchase_requirements.
 * Para cada item, calcula o cycle_date do fornecedor e agrupa
 * itens do mesmo (supplier, masterProduct, cycleDate) em um único requirement.
 * Usa snapshot do item (custo, offer) — nunca o sourcing atual.
 */
export function materializarVendas(
  itens: ItemVendido[],
  fornecedores: Map<string, Fornecedor>,
  momentoVenda: string,
  geral: ConfigGeral,
): RequirementGerado[] {
  const reqs = new Map<string, RequirementGerado>();
  for (const item of itens) {
    const f = fornecedores.get(item.supplierId);
    if (!f) continue;
    const cycleDate = proximoDiaPedido(f, momentoVenda, geral);
    const key = `${item.supplierId}|${item.masterProductId}|${cycleDate}`;
    const existing = reqs.get(key);
    if (existing) {
      existing.qty += item.qty;
      existing.sourceItemIds.push(item.itemId);
    } else {
      reqs.set(key, {
        supplierId: item.supplierId,
        masterProductId: item.masterProductId,
        qty: item.qty,
        unitCostCentavos: item.supplierCostCentavos,
        packCostCentavos: item.packCostCentavos,
        qtdPorEmbalagem: item.qtdPorEmbalagem,
        unidadeCompra: item.unidadeCompra,
        cycleDate,
        sourceItemIds: [item.itemId],
      });
    }
  }
  return [...reqs.values()];
}

// ───────────────────────── Histórico de configuração ─────────────────────────

/** Toda alteração de configuração grava quem, quando e o valor anterior. */
export function registrarAlteracao(usuarioId: string, chave: string, anterior: unknown, novo: unknown, quando: string): AlteracaoConfig {
  return { usuarioId, quando, chave, valorAnterior: anterior, valorNovo: novo };
}

// ───────────────────────── utilitários ─────────────────────────

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function brl(v: number) { return "R$ " + r2(v).toFixed(2).replace(".", ","); }
function fmtPct(v: number) { return v.toFixed(1).replace(".", ",") + "%"; }
