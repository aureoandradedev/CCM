// CCM — Etapa 1: tipos de dados.
// Regras citadas pelo código (R1.1, R2.2...) estão no documento
// "CCM — Estrutura de Operação da Plataforma — Etapa 1".

export type DiaSemana = "domingo" | "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado";

// R1 — Fornecedor
export interface Fornecedor {
  id: string;
  nome: string;
  pedidoMinimoTipo: "valor" | "volume";
  pedidoMinimo: number;          // R$ (valor) ou unidades (volume)
  diasPedido: DiaSemana[];       // dias em que a CCM envia pedido de compra
  prazoEntregaCdDias: number;    // dias úteis após o pedido
  freteTipo: "gratis_acima" | "fixo";
  freteGratisAcima?: number;     // obrigatório se freteTipo = gratis_acima
  freteValor: number;            // valor cobrado quando não há frete grátis
}

// R2 — Produto do fornecedor
export type UnidadeCompra = "unidade" | "caixa" | "fardo" | "rolo";

export interface ProdutoFornecedor {
  id: string;
  fornecedorId: string;
  produtoId: string;             // mesmo produto em fornecedores diferentes = mesmo produtoId
  descricao: string;
  custo: number;                 // custo da unidade de compra (ex.: a caixa inteira)
  unidadeCompra: UnidadeCompra;
  qtdPorEmbalagem: number;       // 1 se unidade
  vendeAvulso: boolean;
  estoque: number;               // em unidades de compra
}

// R3 — Modo de venda
export type ModoVenda = "por_unidade" | "embalagem_fechada" | "unidade_e_caixa" | "nao_vender";

// Configurações [config] — editáveis no painel, nunca fixas no código
export interface ConfigSecao {
  secao: string;
  regraPreco: (custoUnitario: number) => number;  // R5.1 — definida pela direção
  limiteAumentoPct: number;                        // R5.2 — ex.: 8 = 8%
  descontoCaixaPct: number;                        // R3.2 — ex.: 10 = 10%
}

export interface ConfigGeral {
  tetoSobraValor: number;        // R3.3 — R$ máximo parado em sobra
  horarioCorteCiclo: string;     // "HH:MM" — hora em que o pedido do dia é enviado (R4.1)
  feriados: string[];            // "AAAA-MM-DD" — não contam como dia útil
}

export interface Usuario {
  id: string;
  nome: string;
  permissaoDirecao: boolean;     // R3.1
}

// R4.1b — Item vendido (snapshot do order_item no momento do pagamento)
export interface ItemVendido {
  itemId: string;
  supplierId: string;
  masterProductId: string;
  supplierCostCentavos: number;
  qty: number;
  qtdPorEmbalagem: number;
  unidadeCompra: string;
  packCostCentavos: number | null;
}

// R4.1b — Requirement de compra gerado a partir de vendas pagas
export interface RequirementGerado {
  supplierId: string;
  masterProductId: string;
  qty: number;
  unitCostCentavos: number;
  packCostCentavos: number | null;
  qtdPorEmbalagem: number;
  unidadeCompra: string;
  cycleDate: string;
  sourceItemIds: string[];
}

// Histórico de alteração de configuração (regra transversal)
export interface AlteracaoConfig {
  usuarioId: string;
  quando: string;                // ISO
  chave: string;
  valorAnterior: unknown;
  valorNovo: unknown;
}
