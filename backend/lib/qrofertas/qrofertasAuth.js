import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* =========================================================
   qrofertasAuth.js
   Cuida do login no QRofertas e mantém o JWT em disco.

   Por que em disco?
   - O JWT dura 30 dias (vimos no exp do token)
   - Se a gente loga toda hora que reinicia o servidor,
     vira spam pra eles. Mantendo o token em disco,
     a gente faz login só quando ele expira de verdade.
========================================================= */

// Token ao lado deste arquivo (e não no cwd), para o servidor funcionar de qualquer pasta.
const TOKEN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".qrofertas-token.json");
const LOGIN_URL = "https://cdn.qrofertas.com/login/entrar/";

// Margem de segurança: renova o token 1 dia antes de expirar
const MARGEM_EXPIRACAO_MS = 24 * 60 * 60 * 1000;

let tokenCache = null; // cache em memória pra não ler disco toda hora

function lerTokenDoDisco() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = fs.readFileSync(TOKEN_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!data?.token || !data?.expMs) return null;
    return data;
  } catch {
    return null;
  }
}

function gravarTokenNoDisco(token, expMs, email) {
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ token, expMs, email, savedAt: Date.now() }, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("⚠️  Não consegui salvar o token em disco:", e.message);
  }
}

/**
 * Decodifica o payload do JWT (parte do meio).
 * Não verifica assinatura (não precisamos — só queremos ler o exp).
 */
function decodificarJwt(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf8");
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function tokenAindaValido(expMs) {
  if (!expMs) return false;
  return expMs - Date.now() > MARGEM_EXPIRACAO_MS;
}

/**
 * Faz login no QRofertas e devolve o JWT.
 * Lança erro se não conseguir.
 */
async function fazerLogin(email, password) {
  if (!email || !password) {
    throw new Error(
      "QROFERTAS_EMAIL ou QROFERTAS_PASSWORD não configurados no .env"
    );
  }

  console.log("🔐 Fazendo login no QRofertas...");

  const form = new URLSearchParams();
  form.append("next", "https://cdn.qrofertas.com/criar-jornal/builder-v2/");
  form.append("email", email);
  form.append("password", password);
  form.append("request_origin", "modal_criar");

  let resp;
  try {
    resp = await axios.post(LOGIN_URL, form.toString(), {
      maxRedirects: 0, // 302 é esperado, não queremos seguir
      validateStatus: (s) => s === 302 || s === 200,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MultigiroBot/1.0",
        Origin: "https://cdn.qrofertas.com",
        Referer: "https://cdn.qrofertas.com/",
      },
      timeout: 15000,
    });
  } catch (e) {
    // axios trata 302 como erro em algumas versões — captura o response interno
    if (e.response?.status === 302) {
      resp = e.response;
    } else {
      throw new Error(`Falha no login: ${e.message}`);
    }
  }

  // Procura o cookie AUTHORIZATION
  const setCookies = resp.headers["set-cookie"] || [];
  let token = null;

  for (const c of setCookies) {
    const match = c.match(/AUTHORIZATION=([^;]+)/);
    if (match && match[1] && match[1] !== "deleted") {
      token = match[1];
      break;
    }
  }

  if (!token) {
    throw new Error(
      "Login falhou: cookie AUTHORIZATION não voltou. Email/senha podem estar errados."
    );
  }

  const payload = decodificarJwt(token);
  if (!payload?.exp) {
    throw new Error("Login inválido: JWT sem campo 'exp'.");
  }

  const expMs = payload.exp * 1000;
  console.log(
    `✅ Login OK | usuário: ${payload.email} | expira em ${new Date(
      expMs
    ).toISOString()}`
  );

  gravarTokenNoDisco(token, expMs, payload.email);
  tokenCache = { token, expMs, email: payload.email };

  return tokenCache;
}

/**
 * Função principal: devolve um JWT válido.
 * - Se já tem cache válido, devolve.
 * - Senão, lê do disco.
 * - Senão (ou se expirou), faz login.
 */
export async function obterToken() {
  // 1. cache em memória
  if (tokenCache && tokenAindaValido(tokenCache.expMs)) {
    return tokenCache.token;
  }

  // 2. disco
  const fromDisk = lerTokenDoDisco();
  if (fromDisk && tokenAindaValido(fromDisk.expMs)) {
    tokenCache = fromDisk;
    console.log(
      `🔓 Usando token QRofertas em cache (expira ${new Date(
        fromDisk.expMs
      ).toISOString()})`
    );
    return fromDisk.token;
  }

  // 3. login novo
  const email = process.env.QROFERTAS_EMAIL;
  const password = process.env.QROFERTAS_PASSWORD;
  const novo = await fazerLogin(email, password);
  return novo.token;
}

/**
 * Força um relogin (descarta token atual).
 * Útil se a API começar a devolver 401/403.
 */
export async function forcarRelogin() {
  tokenCache = null;
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch {}
  return obterToken();
}