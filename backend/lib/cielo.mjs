/* =========================================================
   💳 cielo.mjs — porte fiel do cieloService.js do e-commerce do mercado (Cloud Functions)
   Integração Pix (Cielo). Credenciais via secrets (process.env em runtime).
   ⚠️ TLS válido da Cielo: axios normal, sem httpsAgent inseguro.
   Config lida de process.env EM TEMPO DE CHAMADA (secrets/params só existem em runtime).
========================================================= */
import axios from "axios";
import { randomUUID } from "crypto"; // RequestId (GUID) no header do void

// true se o ambiente configurado é produção.
function ehProducao() {
  const env = String(process.env.CIELO_ENV || "production").toLowerCase();
  return env === "production" || env === "producao" || env === "prod";
}

// Base URLs por ambiente (CIELO_ENV). Default production nas Functions.
function baseUrls() {
  const producao = ehProducao();
  return producao
    ? {
        create: "https://api.cieloecommerce.cielo.com.br",
        query: "https://apiquery.cieloecommerce.cielo.com.br",
      }
    : {
        create: "https://apisandbox.cieloecommerce.cielo.com.br",
        query: "https://apiquerysandbox.cieloecommerce.cielo.com.br",
      };
}

function headers() {
  const MerchantId = process.env.CIELO_MERCHANT_ID;
  const MerchantKey = process.env.CIELO_MERCHANT_KEY;
  if (!MerchantId || !MerchantKey) {
    throw new Error("Credenciais Cielo ausentes (secrets CIELO_MERCHANT_ID / CIELO_MERCHANT_KEY).");
  }
  return { MerchantId, MerchantKey, "Content-Type": "application/json" };
}

// Provider configurável (default "Cielo" legado — habilitado nesta afiliação).
function pixProvider() {
  return process.env.CIELO_PIX_PROVIDER || "Cielo";
}

// Traduz o Status numérico da Cielo pra um rótulo simples.
// 0 NotFinished, 1 Authorized, 2 Paid, 3 Denied, 10 Voided, 11 Refunded, 12 Pending, 13 Aborted, 20 Scheduled.
export function traduzStatusCielo(status) {
  switch (Number(status)) {
    case 2:
      return "pago";
    case 11:
      return "estornado";
    case 3:
    case 10:
    case 13:
      return "negado";
    default:
      return "pendente"; // 0, 1, 12 (QR gerado/aguardando), 20
  }
}

// Cria a cobrança Pix. amountCentavos é INTEIRO (centavos), calculado no server.
export async function criarCobrancaPix({ merchantOrderId, amountCentavos, expiracaoSegundos = 3600, comprador = {} }) {
  const { create } = baseUrls();

  const body = {
    MerchantOrderId: String(merchantOrderId),
    Customer: {
      Name: String(comprador.nome || "Cliente"),
      Identity: String(comprador.cpf || "").replace(/\D+/g, ""),
      IdentityType: "CPF",
    },
    Payment: {
      Type: "Pix",
      Provider: pixProvider(),
      Amount: Math.round(Number(amountCentavos)), // inteiro, em centavos
      QrCode: { Expiration: Number(expiracaoSegundos) },
    },
  };

  const { data } = await axios.post(`${create}/1/sales/`, body, { headers: headers(), timeout: 30000 });

  const pay = data?.Payment || {};
  return {
    paymentId: pay.PaymentId,
    txid: pay.SentOrderId || null,
    qrCodeString: pay.QrCodeString || "",
    qrCodeBase64: pay.QrCodeBase64Image || "",
    status: pay.Status, // 12 = QR gerado / aguardando
  };
}

// Consulta o status de um pagamento pelo PaymentId.
export async function consultarPix(paymentId) {
  const { query } = baseUrls();
  const { data } = await axios.get(`${query}/1/sales/${paymentId}`, { headers: headers(), timeout: 30000 });
  return { status: data?.Payment?.Status };
}

// Devolve (estorna/cancela) um pagamento Pix.
// PUT {base transacional}/1/sales/{paymentId}/void?amount=<centavos>. Status 11=estornado, 10=cancelado.
export async function devolverPix(paymentId, amountCentavos, { requestId } = {}) {
  const { create } = baseUrls();
  const url = `${create}/1/sales/${paymentId}/void?amount=${Math.round(Number(amountCentavos))}`;
  const { data, status } = await axios.put(url, null, {
    headers: { ...headers(), RequestId: requestId || randomUUID() },
    timeout: 30000,
  });
  return {
    httpStatus: status,
    status: data?.Status,
    returnCode: data?.ReturnCode,
    returnMessage: data?.ReturnMessage,
    raw: data,
  };
}

// Pagamento com CARTÃO (crédito/débito) À VISTA, captura automática.
// O cartão NUNCA passa pelo servidor — recebemos só o PaymentToken do Silent Order Post (SOP).
// Crédito: Installments:1 + Capture:true. Débito: Authenticate:true + ExternalAuthentication (3DS).
export async function criarPagamentoCartao({
  merchantOrderId,
  amountCentavos,
  comprador = {},
  tipo, // "credito" | "debito"
  paymentToken,
  brand,
  dados3ds,
}) {
  const { create } = baseUrls();
  const amount = Math.round(Number(amountCentavos));

  const Customer = {
    Name: String(comprador.nome || "Cliente"),
    Identity: String(comprador.cpf || "").replace(/\D+/g, ""),
    IdentityType: "CPF",
  };

  let Payment;
  if (tipo === "debito") {
    Payment = {
      Type: "DebitCard",
      Provider: "Cielo",
      Amount: amount,
      Authenticate: true, // débito exige autenticação
      Capture: true, // captura automática
      DebitCard: { PaymentToken: String(paymentToken), Brand: String(brand || "") },
      // Dados do 3DS 2.2 vindos do front (resultado da autenticação).
      ExternalAuthentication: {
        Cavv: dados3ds?.Cavv,
        Xid: dados3ds?.Xid,
        Eci: dados3ds?.Eci,
        Version: dados3ds?.Version,
        ReferenceId: dados3ds?.ReferenceId,
      },
    };
  } else {
    Payment = {
      Type: "CreditCard",
      Provider: "Cielo",
      Amount: amount,
      Installments: 1, // à vista, SEM parcelamento
      Capture: true, // captura automática
      CreditCard: { PaymentToken: String(paymentToken), Brand: String(brand || "") },
    };
  }

  const body = { MerchantOrderId: String(merchantOrderId), Customer, Payment };
  const { data } = await axios.post(`${create}/1/sales/`, body, { headers: headers(), timeout: 30000 });

  const pay = data?.Payment || {};
  return {
    paymentId: pay.PaymentId,
    status: pay.Status, // 2 Paid (capturado), 1 Authorized, 3 Denied
    returnCode: pay.ReturnCode,
    returnMessage: pay.ReturnMessage,
  };
}

/* =========================================================
   🔐 TOKENS DE SESSÃO (gerados server-side; credenciais em secrets)
   Usados pelo FRONT: o SOP tokeniza o cartão no browser e o 3DS autentica —
   ambos precisam de um AccessToken de sessão que só pode ser gerado no servidor.
========================================================= */

// Silent Order Post: 2 passos → (1) OAuth2 client_credentials com as credenciais SOP;
// (2) POST no endpoint de accesstoken do SOP (header MerchantId + Bearer) → AccessToken (20 min).
export async function gerarTokenSop() {
  const producao = ehProducao();
  const authUrl = producao
    ? "https://auth.braspag.com.br/oauth2/token"
    : "https://authsandbox.braspag.com.br/oauth2/token";
  // ⚠️ Host CIELO e-commerce (não pagador/Braspag). O front usa provider:"cielo",
  // então o POST do cartão vai p/ o host cieloecommerce; o token TEM que ser mintado aqui.
  const sopUrl = producao
    ? "https://transaction.cieloecommerce.cielo.com.br/post/api/public/v2/accesstoken"
    : "https://transactionsandbox.cieloecommerce.cielo.com.br/post/api/public/v2/accesstoken";

  const clientId = process.env.CIELO_SOP_CLIENT_ID;
  const clientSecret = process.env.CIELO_SOP_CLIENT_SECRET;
  const merchantId = process.env.CIELO_MERCHANT_ID;
  if (!clientId || !clientSecret) throw new Error("Credenciais SOP ausentes (secrets CIELO_SOP_*).");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const oauth = await axios.post(authUrl, "grant_type=client_credentials", {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });
  const bearer = oauth.data?.access_token;

  const sop = await axios.post(sopUrl, {}, {
    headers: { MerchantId: merchantId, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return {
    accessToken: sop.data?.AccessToken,
    environment: producao ? "production" : "sandbox",
  };
}

// 3DS 2.2: OAuth2 (Basic) com credenciais 3DS + body do estabelecimento → access_token
// que o front injeta na classe bpmpi_accesstoken.
export async function gerarToken3ds() {
  const producao = ehProducao();
  const url = producao
    ? "https://mpi.braspag.com.br/v2/auth/token"
    : "https://mpisandbox.braspag.com.br/v2/auth/token";

  const clientId = process.env.CIELO_3DS_CLIENT_ID;
  const clientSecret = process.env.CIELO_3DS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais 3DS ausentes (secrets CIELO_3DS_*).");

  const body = {
    EstablishmentCode: process.env.CIELO_3DS_ESTABLISHMENT_CODE || "",
    MerchantName: process.env.CIELO_3DS_MERCHANT_NAME || "",
    MCC: process.env.CIELO_3DS_MCC || "",
  };
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await axios.post(url, body, {
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return {
    accessToken: r.data?.access_token || r.data?.AccessToken,
    environment: producao ? "production" : "sandbox",
  };
}
