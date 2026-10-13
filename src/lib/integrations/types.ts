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
 * produza `CanonicalProduct`. O restante do marketplace não muda.
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
  category?: string;
  price: number;
  promoPrice?: number;
  stock: number;
  unit?: string; // un, cx, kg, m, m2, saco...
  weightKg?: number;
  dimensions?: CanonicalDimensions;
  images?: string[];
  status?: CanonicalStatus;
  variations?: CanonicalVariation[];
  supplierId?: string; // preenchido no servidor, nunca pelo arquivo
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
  { key: "name", label: "Nome", required: true, type: "string", hint: "Nome que aparece na loja", aliases: ["nome", "name", "descricao", "descrição", "produto", "titulo", "título", "title"] },
  { key: "price", label: "Preço", required: true, type: "number", hint: "Preço de venda (R$)", aliases: ["preco", "preço", "price", "valor", "preco_venda", "vlr", "valor_unitario"] },
  { key: "stock", label: "Estoque", required: true, type: "number", hint: "Quantidade disponível", aliases: ["estoque", "stock", "saldo", "qtd", "quantidade", "disponivel", "disponível", "qty"] },
  { key: "gtin", label: "EAN / GTIN", required: false, type: "string", hint: "Código de barras", aliases: ["ean", "gtin", "barras", "codigo_barras", "código_barras", "cod_barras", "upc"] },
  { key: "description", label: "Descrição", required: false, type: "string", aliases: ["descricao", "descrição", "description", "detalhes", "obs", "observacao"] },
  { key: "brand", label: "Marca", required: false, type: "string", aliases: ["marca", "brand", "fabricante", "fornecedor_marca"] },
  { key: "category", label: "Categoria", required: false, type: "string", aliases: ["categoria", "category", "secao", "seção", "departamento", "grupo", "linha"] },
  { key: "promoPrice", label: "Preço promocional", required: false, type: "number", aliases: ["promocional", "promo", "preco_promocional", "preço_promocional", "oferta", "desconto", "preco_oferta"] },
  { key: "unit", label: "Unidade", required: false, type: "string", hint: "un, cx, kg, m, m²...", aliases: ["unidade", "unit", "un", "medida", "um"] },
  { key: "weightKg", label: "Peso (kg)", required: false, type: "number", aliases: ["peso", "weight", "peso_kg", "kg"] },
  { key: "images", label: "Imagens", required: false, type: "list", hint: "URLs separadas por vírgula ou |", aliases: ["imagem", "imagens", "image", "images", "foto", "fotos", "url_imagem", "img"] },
  { key: "status", label: "Status", required: false, type: "enum", aliases: ["status", "situacao", "situação", "ativo", "active"] },
];

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
