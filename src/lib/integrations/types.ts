/**
 * Central de Integração do Fornecedor — tipos canônicos.
 *
 * O CCM nunca acopla seu núcleo a um ERP específico. Todo sistema externo
 * (ERP, planilha, API, feed) converte seus dados para o MODELO CANÔNICO abaixo
 * através de um Adapter/Connector:
 *
 *     Sistema externo  →  Adapter/Connector  →  CanonicalProduct (padrão CCM)
 *
 * Adicionar um novo ERP no futuro = criar um novo connector + adapter que
 * produza `CanonicalProduct`. O restante do sistema não muda.
 */

/** Métodos de onboarding mostrados no wizard (etapa 1). */
export type IntegrationMethod = "erp" | "csv" | "api" | "feed" | "manual";

/** Disponibilidade de um connector na interface. */
export type ConnectorStatus = "available" | "coming_soon";

/** O que um connector consegue (ou conseguirá) sincronizar. */
export type SyncCapability =
  | "products"
  | "catalog"
  | "stock"
  | "price"
  | "availability"
  | "images"
  | "orders";

/** Direção do fluxo de sincronização. */
export type SyncDirection = "erp_to_ccm" | "ccm_to_erp";

/** Status do produto dentro do CCM. */
export type CanonicalStatus = "active" | "inactive" | "draft";

/** Dimensões físicas (cm) para cálculo futuro de frete por fornecedor. */
export interface CanonicalDimensions {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

/** Variação de um produto (ex.: cor, tamanho). */
export interface CanonicalVariation {
  sku: string;
  name: string;
  gtin?: string;
  price?: number;
  promoPrice?: number;
  stock?: number;
  attributes?: Record<string, string>;
}

/**
 * Formato canônico interno de produto do CCM. É PARA ISSO que toda integração
 * converte. `supplierId` nunca vem do arquivo do fornecedor: é injetado pelo
 * servidor a partir da sessão autenticada (isolamento por empresa).
 */
export interface CanonicalProduct {
  sku: string;
  gtin?: string; // EAN/GTIN
  name: string;
  description?: string;
  brand?: string;
  model?: string;
  category?: string;
  subcategory?: string;
  price: number;
  promoPrice?: number;
  stock: number;
  unit?: string; // un, cx, kg, m, m2, saco...
  packInfo?: string;
  leadTimeDays?: number;
  weightKg?: number;
  dimensions?: CanonicalDimensions;
  images?: string[];
  status?: CanonicalStatus;
  variations?: CanonicalVariation[];
  supplierId?: string; // preenchido no servidor, nunca pelo arquivo

  // CCM Etapa 1 — embalagem
  unidadeCompra?: string; // unidade, caixa, fardo, rolo
  qtdPorEmbalagem?: number;
  vendeAvulso?: boolean;
}

/**
 * Catálogo dos campos canônicos usados no mapeamento de colunas (CSV/feed) e na
 * sugestão automática. `aliases` alimenta a heurística de auto-mapeamento.
 */
export interface CanonicalFieldDef {
  key: keyof CanonicalProduct;
  label: string;
  required: boolean;
  type: "string" | "number" | "list" | "enum";
  hint?: string;
  aliases: string[];
}

export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  { key: "sku", label: "SKU / Código", required: true, type: "string", hint: "Identificador único do produto no seu sistema", aliases: ["sku", "codigo", "código", "cod", "ref", "referencia", "referência", "id", "item"] },
  { key: "name", label: "Nome", required: true, type: "string", hint: "Nome do produto", aliases: ["nome", "name", "produto", "titulo", "título", "title", "descricao", "descrição"] },
  { key: "price", label: "Custo / preço de fornecimento", required: true, type: "number", hint: "Custo unitário (R$)", aliases: ["custo", "preco", "preço", "preco_custo", "preço_custo", "custo_unitario", "custo_unitário", "valor", "valor_unitario", "valor_unitário", "price", "cost", "vlr"] },
  { key: "stock", label: "Estoque", required: true, type: "number", hint: "Quantidade disponível", aliases: ["estoque", "stock", "saldo", "qtd", "quantidade", "disponivel", "disponível", "qty"] },
  { key: "gtin", label: "EAN / GTIN", required: false, type: "string", hint: "Código de barras", aliases: ["ean", "gtin", "barras", "codigo_barras", "código_barras", "cod_barras", "upc"] },
  { key: "description", label: "Descrição", required: false, type: "string", aliases: ["descricao", "descrição", "description", "detalhes", "obs", "observacao"] },
  { key: "brand", label: "Marca", required: false, type: "string", aliases: ["marca", "brand", "fabricante", "fornecedor_marca"] },
  { key: "model", label: "Modelo", required: false, type: "string", aliases: ["modelo", "model", "referencia_modelo", "ref_modelo"] },
  { key: "category", label: "Categoria", required: false, type: "string", aliases: ["categoria", "category", "secao", "seção", "departamento", "grupo", "linha"] },
  { key: "subcategory", label: "Subcategoria", required: false, type: "string", aliases: ["subcategoria", "subcategory", "subgrupo", "sublinha", "tipo"] },
  { key: "unit", label: "Unidade", required: false, type: "string", hint: "un, cx, kg, m, m²...", aliases: ["unidade", "unit", "un", "medida", "um"] },
  { key: "packInfo", label: "Embalagem", required: false, type: "string", hint: "Ex.: cx c/ 12, pct c/ 5", aliases: ["embalagem", "pack", "pack_info", "pacote", "caixa", "fardo"] },
  { key: "leadTimeDays", label: "Prazo de fornecimento (dias)", required: false, type: "number", hint: "Dias úteis para entrega", aliases: ["prazo", "prazo_dias", "lead_time", "lead_time_days", "prazo_entrega", "prazo_de_entrega", "dias_entrega"] },
  { key: "weightKg", label: "Peso (kg)", required: false, type: "number", aliases: ["peso", "weight", "peso_kg", "kg"] },
  { key: "images", label: "Imagens", required: false, type: "list", hint: "URLs separadas por vírgula ou |", aliases: ["imagem", "imagens", "image", "images", "foto", "fotos", "url_imagem", "img"] },
  { key: "status", label: "Status", required: false, type: "enum", aliases: ["status", "situacao", "situação", "ativo", "active"] },
  { key: "unidadeCompra", label: "Unidade de compra", required: false, type: "string", hint: "unidade, caixa, fardo, rolo", aliases: ["unidade_compra", "unidadecompra", "tipo_embalagem", "tipo_emb", "emb_tipo", "purchase_unit"] },
  { key: "qtdPorEmbalagem", label: "Qtd por embalagem", required: false, type: "number", hint: "Quantidade por embalagem (1 se unidade)", aliases: ["qtd_por_embalagem", "qtd_embalagem", "qtdembalagem", "un_por_caixa", "un_cx", "pack_qty", "qtd_por_cx", "pecas_emb", "pcs_emb"] },
  { key: "vendeAvulso", label: "Vende avulso", required: false, type: "enum", hint: "sim / não", aliases: ["vende_avulso", "avulso", "vendeavulso", "venda_avulsa", "sell_single"] },
];

// ─── Integration Foundation (Phase 8) ─────────────────────────────────────

export type IntegrationStatus =
  | "disconnected"
  | "configured"
  | "testing"
  | "connected"
  | "syncing"
  | "error"
  | "paused";

export type SyncMode = "full" | "delta";

export type BatchStatus = "running" | "completed" | "partial" | "failed";

export type ConnectorCapability =
  | "full_catalog"
  | "incremental_sync"
  | "stock"
  | "cost"
  | "images"
  | "lead_time";

export type IntegrationErrorKind =
  | "configuration_error"
  | "authentication_error"
  | "connection_error"
  | "invalid_payload"
  | "partial_import"
  | "internal_error";

/**
 * Contrato canônico de integração (Fase 8).
 *
 * Qualquer connector (ERP, API, feed, arquivo, agente local) traduz o
 * sistema externo para este formato. Depois disso, o restante do CCM
 * não precisa conhecer o ERP de origem.
 *
 * Mapeia 1:1 para supplier_catalog_items (0005 + 0010).
 */
export interface ExternalCatalogItem {
  external_id: string;
  supplier_sku?: string;
  ean?: string;
  name: string;
  description?: string;
  brand?: string;
  model?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  pack_info?: string;
  cost_centavos: number;
  stock?: number | null;
  lead_time_days?: number;
  image_url?: string;
  images?: string[];
  attributes?: Record<string, unknown>;
  available?: boolean;
  updated_at?: string;
}

/** Resultado da transformação de uma linha de origem em produto canônico. */
export interface RowResult {
  index: number;
  raw: Record<string, string>;
  product?: CanonicalProduct;
  errors: string[];
  warnings: string[];
}

/** Resumo de uma importação/pré-visualização (etapas 3 e 4 do wizard). */
export interface ImportSummary {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  withStock: number;
  withPrice: number;
  withImages: number;
  rows: RowResult[];
}
