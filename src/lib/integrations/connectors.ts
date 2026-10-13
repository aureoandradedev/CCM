/**
 * Registro de métodos e connectors de integração.
 *
 * REGRA: só marcar como `available` o que REALMENTE funciona hoje. Tudo que
 * ainda não tem backend/connector fica `coming_soon` ("Em breve") — a interface
 * nunca promete uma conexão que não existe.
 *
 * Adicionar um ERP no futuro = acrescentar uma entrada aqui e seu adapter em
 * `adapters/`. Nada no núcleo do marketplace precisa mudar.
 */
import type {
  IntegrationMethod,
  ConnectorStatus,
  SyncCapability,
  SyncDirection,
} from "./types";

export interface MethodDef {
  id: IntegrationMethod;
  title: string;
  /** Uma frase explicando o que faz (usada nos cards da etapa 1). */
  tagline: string;
  /** Ícone lucide-react (nome) — resolvido na UI. */
  icon: string;
  status: ConnectorStatus;
  /** Tempo/esforço comunicado ao fornecedor. */
  effort: string;
}

/** Etapa 1 do wizard: "Como você quer conectar seu catálogo?" */
export const INTEGRATION_METHODS: MethodDef[] = [
  {
    id: "erp",
    title: "Conectar meu ERP",
    tagline: "Ligue seu sistema de gestão e deixe estoque e preço sincronizarem sozinhos.",
    icon: "Plug",
    status: "coming_soon",
    effort: "Em breve",
  },
  {
    id: "csv",
    title: "Importar Excel/CSV",
    tagline: "Envie sua planilha de produtos e nós mapeamos as colunas para você.",
    icon: "FileSpreadsheet",
    status: "available",
    effort: "~5 minutos",
  },
  {
    id: "api",
    title: "Usar a API do CCM",
    tagline: "Tem sistema próprio? Integre produtos, estoque e pedidos via API REST.",
    icon: "Code2",
    status: "available",
    effort: "Para desenvolvedores",
  },
  {
    id: "feed",
    title: "Feed / URL",
    tagline: "Aponte um link JSON, XML ou CSV e o CCM lê seu catálogo periodicamente.",
    icon: "Rss",
    status: "coming_soon",
    effort: "Em breve",
  },
  {
    id: "manual",
    title: "Cadastrar manualmente",
    tagline: "Sem sistema? Cadastre seus produtos direto no painel do CCM.",
    icon: "PencilLine",
    status: "available",
    effort: "No seu ritmo",
  },
];

export interface ConnectorDef {
  id: string;
  name: string;
  method: IntegrationMethod;
  status: ConnectorStatus;
  /** Frase curta sobre o connector. */
  description: string;
  capabilities: SyncCapability[];
  directions: SyncDirection[];
}

/**
 * Connectors de ERP. TODOS `coming_soon` — nenhum tem conexão real ainda.
 * Quando um for implementado, mudar `status` para `available` e registrar o
 * adapter correspondente em `adapters/<id>.ts`.
 */
export const ERP_CONNECTORS: ConnectorDef[] = [
  { id: "bling", name: "Bling", method: "erp", status: "coming_soon", description: "ERP popular para pequenas e médias empresas.", capabilities: ["products", "stock", "price", "orders"], directions: ["erp_to_ccm", "ccm_to_erp"] },
  { id: "tiny", name: "Tiny (Olist)", method: "erp", status: "coming_soon", description: "Gestão e catálogo integrados.", capabilities: ["products", "stock", "price", "orders"], directions: ["erp_to_ccm", "ccm_to_erp"] },
  { id: "omie", name: "Omie", method: "erp", status: "coming_soon", description: "ERP com financeiro e estoque.", capabilities: ["products", "stock", "price", "orders"], directions: ["erp_to_ccm", "ccm_to_erp"] },
  { id: "totvs-protheus", name: "TOTVS Protheus", method: "erp", status: "coming_soon", description: "ERP corporativo para grandes distribuidores.", capabilities: ["products", "stock", "price", "catalog"], directions: ["erp_to_ccm", "ccm_to_erp"] },
  { id: "sankhya", name: "Sankhya", method: "erp", status: "coming_soon", description: "Gestão para indústria e distribuição.", capabilities: ["products", "stock", "price"], directions: ["erp_to_ccm", "ccm_to_erp"] },
  { id: "linx", name: "Linx", method: "erp", status: "coming_soon", description: "ERP de varejo e materiais de construção.", capabilities: ["products", "stock", "price"], directions: ["erp_to_ccm"] },
];

export function methodById(id: IntegrationMethod): MethodDef | undefined {
  return INTEGRATION_METHODS.find((m) => m.id === id);
}

export function isMethodAvailable(id: IntegrationMethod): boolean {
  return methodById(id)?.status === "available";
}

/** Rótulos legíveis para capacidades e direções (UI da área de Integrações). */
export const CAPABILITY_LABELS: Record<SyncCapability, string> = {
  products: "Produtos",
  catalog: "Catálogo",
  stock: "Estoque",
  price: "Preço",
  availability: "Disponibilidade",
  images: "Imagens",
  orders: "Pedidos",
};

export const DIRECTION_LABELS: Record<SyncDirection, string> = {
  erp_to_ccm: "ERP → CCM",
  ccm_to_erp: "CCM → ERP",
};
