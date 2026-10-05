"use client";

/**
 * CardCore — porte fiel do `cardCore-mrcd-v1.js` do e-commerce do mercado
 * (Silent Order Post da Cielo + 3DS 2.2 para débito).
 *
 * O número do cartão é tokenizado NO NAVEGADOR pela Cielo e NUNCA passa pelo
 * nosso backend. Os scripts da Cielo leem campos hidden PELA CLASSE
 * (bp-sop-* e bpmpi_*), que o <CardPanel> renderiza.
 */

import { API_BASE } from "@/lib/api";

export type CardTipo = "credito" | "debito";

export const CARD_SCRIPTS = {
  production: {
    sop: "https://transaction.cieloecommerce.cielo.com.br/post/Scripts/silentorderpost-1.0.min.js",
    mpi: "https://mpi.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js",
  },
  sandbox: {
    sop: "https://transactionsandbox.cieloecommerce.cielo.com.br/post/Scripts/silentorderpost-1.0.min.js",
    mpi: "https://mpisandbox.braspag.com.br/Scripts/BP.Mpi.3ds20.min.js",
  },
} as const;

type Env = "production" | "sandbox" | "mock";

interface TokenResp {
  ok: boolean;
  accessToken: string;
  environment: Env;
}

interface SopResp {
  PaymentToken?: string;
  Brand?: string;
  Message?: string;
  ErrorMessage?: string;
}

export interface Dados3ds {
  Cavv?: string;
  Xid?: string;
  Eci?: string;
  Version?: string;
  ReferenceId?: string;
}

declare global {
  interface Window {
    bpSop_silentOrderPost?: (cfg: Record<string, unknown>) => void;
    bpmpi_config?: () => Record<string, unknown>;
    bpmpi_authenticate?: () => void;
  }
}

const scriptsCarregados = new Map<string, Promise<void>>();
export function carregarScript(src: string): Promise<void> {
  const cached = scriptsCarregados.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Falha ao carregar script do cartão."));
    document.head.appendChild(s);
  });
  scriptsCarregados.set(src, p);
  return p;
}

/** Bandeira pelo BIN: o SOP não devolve Brand e a Cielo exige (erro 999 sem ele). */
export function detectarBandeira(num: string): string {
  const n = String(num || "").replace(/\D+/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]\d|720))/.test(n)) return "Master";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(606282|3841)/.test(n)) return "Hipercard";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|651|655)/.test(n)) return "Elo";
  if (/^3(0[0-5]|[68])/.test(n)) return "Diners";
  if (/^(6011|65|64[4-9])/.test(n)) return "Discover";
  if (/^35/.test(n)) return "JCB";
  return "";
}

async function fetchToken(rota: "sop-token" | "3ds-token"): Promise<TokenResp> {
  // cache:"no-store": o token de sessão é single-use; NUNCA reaproveitar do cache.
  const r = await fetch(`${API_BASE}/pagamentos/cartao/${rota}`, { cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as Partial<TokenResp> & { erro?: string };
  if (!r.ok || !d.ok || !d.accessToken) throw new Error(d.erro || "Falha ao obter token do cartão.");
  return d as TokenResp;
}

/** Token do SOP evitando '+': o script manda o token CRU em form-urlencoded e '+' viraria espaço. */
async function fetchSopToken(): Promise<TokenResp> {
  let d = await fetchToken("sop-token");
  for (let i = 0; i < 4 && String(d.accessToken || "").includes("+"); i++) d = await fetchToken("sop-token");
  return d;
}

function setByClass(root: ParentNode, cls: string, v: string) {
  const n = root.querySelector<HTMLInputElement>("." + cls);
  if (n) n.value = v;
}

export interface CamposCartao {
  holder: string;
  numeroDigits: string;
  expMMYYYY: string;
  cvv: string;
}

function preencherCamposSop(root: ParentNode, campos: CamposCartao, tipo: CardTipo) {
  setByClass(root, "bp-sop-cardholdername", campos.holder);
  setByClass(root, "bp-sop-cardnumber", campos.numeroDigits);
  setByClass(root, "bp-sop-cardexpirationdate", campos.expMMYYYY);
  setByClass(root, "bp-sop-cardcvv", campos.cvv);
  setByClass(root, "bp-sop-cardtype", tipo === "debito" ? "debitCard" : "creditCard");
}

function tokenizarSop(root: ParentNode, accessToken: string, environment: Env, tipo: CardTipo, campos: CamposCartao): Promise<{ paymentToken: string; brand: string }> {
  return new Promise((resolve, reject) => {
    if (typeof window.bpSop_silentOrderPost !== "function") {
      reject(new Error("Script do cartão não carregou. Recarregue a página."));
      return;
    }
    preencherCamposSop(root, campos, tipo);
    window.bpSop_silentOrderPost({
      accessToken,
      environment,
      language: "PT",
      provider: "cielo",
      cardType: tipo === "debito" ? "debitCard" : "creditCard",
      onSuccess: (resp: SopResp) =>
        resp && resp.PaymentToken ? resolve({ paymentToken: resp.PaymentToken, brand: resp.Brand || "" }) : reject(new Error("SOP não retornou PaymentToken.")),
      onError: (resp: SopResp) => reject(new Error((resp && (resp.Message || resp.ErrorMessage)) || "Erro ao tokenizar o cartão.")),
      onInvalid: (resp: SopResp) => reject(new Error((resp && resp.Message) || "Dados do cartão inválidos. Confira número, validade (MM/AA) e CVV.")),
    });
  });
}

let resolve3ds: ((d: Dados3ds) => void) | null = null;
let reject3ds: ((e: Error) => void) | null = null;

function garantir3dsConfig(environment: Env) {
  // O script chama bpmpi_config() como FUNÇÃO e usa o objeto retornado.
  window.bpmpi_config = function () {
    return {
      Environment: environment === "production" ? "PRD" : "SDB",
      Debug: false,
      onSuccess: (e: Dados3ds) => resolve3ds?.({ Cavv: e.Cavv, Xid: e.Xid, Eci: e.Eci, Version: e.Version, ReferenceId: e.ReferenceId }),
      onFailure: () => reject3ds?.(new Error("Autenticação do cartão de débito falhou. Use crédito ou Pix.")),
      onUnenrolled: () => reject3ds?.(new Error("Cartão não elegível ao 3DS. Use crédito ou Pix.")),
      onUnsupportedBrand: () => reject3ds?.(new Error("Bandeira não suportada no débito. Use crédito ou Pix.")),
      onError: () => reject3ds?.(new Error("Não foi possível autenticar o cartão de débito. Use crédito ou Pix.")),
      onDisabled: () => reject3ds?.(new Error("Autenticação indisponível. Use crédito ou Pix.")),
    };
  };
}

function autenticar3ds(root: ParentNode, accessToken: string, { numeroDigits, mes, ano, valorCentavos, orderNumber }: { numeroDigits: string; mes: string; ano: string; valorCentavos: number; orderNumber: string }): Promise<Dados3ds> {
  return new Promise((resolve, reject) => {
    resolve3ds = resolve;
    reject3ds = reject;
    setByClass(root, "bpmpi_accesstoken", accessToken);
    setByClass(root, "bpmpi_ordernumber", orderNumber || "");
    setByClass(root, "bpmpi_currency", "BRL");
    setByClass(root, "bpmpi_totalamount", String(valorCentavos));
    setByClass(root, "bpmpi_installments", "1");
    setByClass(root, "bpmpi_paymentmethod", "Debit");
    setByClass(root, "bpmpi_cardnumber", numeroDigits);
    setByClass(root, "bpmpi_cardexpirationmonth", mes);
    setByClass(root, "bpmpi_cardexpirationyear", ano);
    if (typeof window.bpmpi_authenticate !== "function") {
      reject(new Error("Script de autenticação (3DS) não carregou. Tente crédito ou Pix."));
      return;
    }
    try {
      window.bpmpi_authenticate();
    } catch (e) {
      reject(e as Error);
    }
  });
}

/** Lê e valida os campos visíveis. */
export function collectCardFields(v: { holder: string; number: string; expiry: string; cvv: string }): { ok: false; msg: string } | { ok: true; mes: string; ano: string; numeroDigits: string; campos: CamposCartao } {
  const numeroDigits = v.number.replace(/\D+/g, "");
  const expiry = v.expiry.trim();
  const cvv = v.cvv.replace(/\D+/g, "");
  const holder = v.holder.trim();
  const mExp = expiry.match(/^(\d{2})\s*\/\s*(\d{2,4})$/);
  if (!holder || numeroDigits.length < 13 || !mExp || cvv.length < 3) {
    return { ok: false, msg: "Confira os dados do cartão (número, validade MM/AA, CVV e nome)." };
  }
  const mes = mExp[1];
  const ano = mExp[2].length === 2 ? "20" + mExp[2] : mExp[2];
  return { ok: true, mes, ano, numeroDigits, campos: { holder, numeroDigits, expMMYYYY: `${mes}/${ano}`, cvv } };
}

export interface ResultadoCartao {
  tipo: CardTipo;
  paymentToken: string;
  brand: string;
  dados3ds: Dados3ds | null;
}

/** Fluxo completo de tokenização (+3DS no débito). Devolve o que o backend precisa. */
export async function processCard({
  root,
  tipo,
  campos,
  numeroDigits,
  mes,
  ano,
  orderNumber,
  onStatus,
}: {
  root: ParentNode;
  tipo: CardTipo;
  campos: CamposCartao;
  numeroDigits: string;
  mes: string;
  ano: string;
  orderNumber: string;
  onStatus?: (msg: string) => void;
}): Promise<ResultadoCartao> {
  const say = onStatus ?? (() => {});
  const brand = detectarBandeira(numeroDigits);

  if (tipo === "debito") {
    say("Autenticando o cartão…");
    const tok3ds = await fetchToken("3ds-token");
    if (tok3ds.environment === "mock") {
      say("Tokenizando o cartão…");
      return { tipo, paymentToken: mockToken(numeroDigits), brand, dados3ds: { Cavv: "mock", Xid: "mock", Eci: "05", Version: "2.2.0", ReferenceId: "mock" } };
    }
    garantir3dsConfig(tok3ds.environment);
    await carregarScript(CARD_SCRIPTS[tok3ds.environment]?.mpi || CARD_SCRIPTS.production.mpi);
    const dados3ds = await autenticar3ds(root, tok3ds.accessToken, { numeroDigits, mes, ano, valorCentavos: 0, orderNumber });

    say("Tokenizando o cartão…");
    const tokSop = await fetchSopToken();
    await carregarScript(CARD_SCRIPTS[tokSop.environment as "production" | "sandbox"]?.sop || CARD_SCRIPTS.production.sop);
    const { paymentToken } = await tokenizarSop(root, tokSop.accessToken, tokSop.environment, tipo, campos);
    return { tipo, paymentToken, brand, dados3ds };
  }

  say("Tokenizando o cartão…");
  const tokSop = await fetchSopToken();
  if (tokSop.environment === "mock") return { tipo, paymentToken: mockToken(numeroDigits), brand, dados3ds: null };
  await carregarScript(CARD_SCRIPTS[tokSop.environment as "production" | "sandbox"]?.sop || CARD_SCRIPTS.production.sop);
  const { paymentToken } = await tokenizarSop(root, tokSop.accessToken, tokSop.environment, tipo, campos);
  return { tipo, paymentToken, brand, dados3ds: null };
}

/** Modo de teste do backend (PAGAMENTO_MOCK): número começando com 0000 é recusado. */
function mockToken(numeroDigits: string) {
  return numeroDigits.startsWith("0000") ? `mock-negar-${Date.now()}` : `mock-${Date.now()}`;
}

/* ---- máscaras visuais ---- */
export function maskCardNumber(v: string) {
  return v.replace(/\D+/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}
export function maskExpiry(v: string, deleting = false) {
  const d = v.replace(/\D+/g, "").slice(0, 4);
  if (d.length > 2) return d.slice(0, 2) + "/" + d.slice(2);
  if (d.length === 2 && !deleting) return d + "/";
  return d;
}
export function maskCvv(v: string) {
  return v.replace(/\D+/g, "").slice(0, 4);
}
