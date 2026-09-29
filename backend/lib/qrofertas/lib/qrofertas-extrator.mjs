/* =========================================================================
   qrofertas-extrator.mjs — extração de candidatos REAIS do HTML do QRofertas
   ==========================================================================
   Bug de produção (24/07): textos de interface ("Resultado da Busca…",
   "Arraste Ver", fragmentos "<div c") chegavam ao matcher como candidatos.
   Este extrator devolve SOMENTE resultados de produto com identificador
   (pem_id + hash) e título minimamente válido; tudo o mais é descartado
   ANTES do matcher, com motivo registrado para diagnóstico.

   Camadas do fluxo (separação exigida):
     qrofertasAuth.js  → autenticação/token
     qrofertasService  → busca (HTTP)
     ESTE MÓDULO       → extração dos resultados
     imagem-matcher    → score/compatibilidade
     imagem-validador  → validação técnica da URL
========================================================================= */

import { QUALIFICADORES_ESTADO, expandirAbreviacoes } from "./imagem-matcher.mjs";

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// frases/palavras típicas do chrome da página (nunca são produto)
const INTERFACE_PADROES = [
  /resultado da busca/i,
  /\barraste\b/i,
  /\bver\b\s*$/i,
  /^novo\b/i,
  /seus produtos/i,
  /cadastrados? ou sugeri/i,
  /carregando/i,
  /nenhum resultado/i,
  /criar jornal/i,
];

export function ehTextoDeInterface(texto) {
  const t = norm(texto);
  if (!t) return true;
  if (t.includes("<") || t.includes(">")) return true; // fragmento de HTML vazado
  return INTERFACE_PADROES.some((re) => re.test(t));
}

export function tituloValido(texto) {
  const t = norm(texto);
  if (t.length < 5 || t.length > 160) return false;
  if (!/[a-z]{3,}/.test(t)) return false;         // precisa de palavra de verdade
  if (ehTextoDeInterface(t)) return false;
  return true;
}

/**
 * Extrai candidatos reais do HTML da busca.
 * Retorna { candidatos, descartados, brutos }:
 *   candidatos: [{ id (pemId), hashId, titulo, urlImagemDireta|null, bruto }]
 *   descartados: [{ motivo, amostra }]  ← diagnóstico (requisito 6)
 */
export function extrairCandidatos(html) {
  const candidatos = [];
  const descartados = [];
  if (typeof html !== "string" || !html) return { candidatos, descartados, brutos: 0 };

  // cada resultado real vem num bloco <div … data-pem_id data-hash_id_s …>
  const re = /<div\b[^>]*>/gi;
  let m;
  let brutos = 0;
  while ((m = re.exec(html)) !== null && candidatos.length < 8) {
    const tag = m[0];
    const temPem = /data-pem_id="(\d+)"/.exec(tag);
    const temHash = /data-hash_id_s="([a-f0-9]+)"/.exec(tag);
    // blocos sem identificador de resultado não são produto — só contam como "bruto"
    if (!temPem && !temHash) continue;
    brutos++;

    const janela = html.slice(m.index, m.index + 1600);
    const titulo =
      janela.match(/data-(?:pem_)?(?:nome|name|title|produto|descricao)[^=]*="([^"]{3,160})"/i)?.[1] ||
      janela.match(/title="([^"]{3,160})"/i)?.[1] ||
      janela.match(/alt="([^"]{3,160})"/i)?.[1] ||
      janela.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

    const urlImagemDireta =
      janela.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i)?.[1] ||
      janela.match(/data-(?:src|imagem|thumb)[^=]*="(https?:\/\/[^"]+)"/i)?.[1] || null;

    const pemId = temPem ? Number(temPem[1]) : null;
    const hashId = temHash ? temHash[1] : null;

    if (!pemId || !hashId) {
      descartados.push({ motivo: "sem-identificador-de-resultado", amostra: norm(titulo).slice(0, 60) });
      continue;
    }
    if (ehTextoDeInterface(titulo)) {
      descartados.push({ motivo: "texto-de-interface", amostra: norm(titulo).slice(0, 60) });
      continue;
    }
    if (!tituloValido(titulo)) {
      descartados.push({ motivo: "titulo-invalido", amostra: norm(titulo).slice(0, 60) });
      continue;
    }
    if (!urlImagemDireta && !hashId) {
      descartados.push({ motivo: "sem-url-de-imagem", amostra: norm(titulo).slice(0, 60) });
      continue;
    }
    candidatos.push({ id: pemId, hashId, titulo: titulo.trim(), urlImagemDireta, bruto: undefined });
  }
  return { candidatos, descartados, brutos };
}

/* ---------------- LOADERS assíncronos (fluxo real do QRofertas) ----------------
   O passo 1 (api-produtos) NÃO devolve cards finais: devolve PLACEHOLDERS com
   data-loader_type="wait_search"|"downloaded" + data-query_hash + data-pem_id.
   Os produtos reais só existem na resposta do POST api-search-images
   (tmp_produto), que o fluxo antigo (b44b787) já usava — por isso ele achava
   a imagem do PATINHO. Aqui extraímos os loaders; o service resolve com
   polling e SÓ então os cards viram candidatos. */

export function extrairLoaders(html) {
  const loaders = [];
  if (typeof html !== "string" || !html) return loaders;
  const re = /<[a-z]+\b[^>]*data-(?:query_hash|hash_id_s|loader_type)[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null && loaders.length < 8) {
    const tag = m[0];
    // aceita aspas simples OU duplas e hash em qualquer caixa (shell real usa variações)
    const pemId = Number(/data-pem_id=["']?(\d+)["']?/.exec(tag)?.[1] || 0) || null;
    const hashId =
      /data-query_hash=["']([A-Fa-f0-9]{6,})["']/.exec(tag)?.[1] ||
      /data-hash_id_s=["']([A-Fa-f0-9]{6,})["']/.exec(tag)?.[1] || null;
    const loaderType = (/data-loader_type=["']([a-z_]+)["']/i.exec(tag)?.[1] || "").toLowerCase() || null;
    if (!hashId) continue; // atributo vazio (template/shell) não é loader
    if (loaders.some((l) => l.hashId === hashId && l.pemId === pemId)) continue;
    loaders.push({ pemId, hashId, loaderType });
  }
  return loaders;
}

/* ---- ANÁLISE DO HTML DO GET api-produtos (200 ≠ resposta completa) ----
   QRofertas lento devolve 200 com SHELL (template com data-attrs vazios,
   ~760 bytes na captura real) antes de montar os resultados. */
export function analisarHtmlBusca(html) {
  const s = typeof html === "string" ? html : "";
  const loaders = extrairLoaders(s);
  const cards = extrairCandidatos(s);

  // "zero resultados" só vale em TEXTO VISÍVEL/estruturado da resposta:
  // remove <script>/<template>/comentários/elementos ocultos ANTES de procurar,
  // e NUNCA vale se existem loaders ou cards (fix: loaders=4 + zeroExplicito=true).
  const visivel = s
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*(?:display\s*:\s*none|hidden|class=["'][^"']*(?:template|hidden)[^"']*["'])[^>]*>[\s\S]*?<\/[a-z]+>/gi, " ")
    .replace(/<[^>]+>/g, " "); // só o texto
  const temMensagemSemResultado =
    loaders.length === 0 &&
    cards.candidatos.length === 0 &&
    /nenhum\s+(produto|resultado)|n[aã]o\s+encontrad|sem\s+resultados?/i.test(visivel);

  const indicadoresShell =
    /loading|carregando|spinner|skeleton/i.test(s) ||
    /data-(?:pem_id|hash_id_s)=["']{2}/.test(s); // atributos VAZIOS = template
  const completa = loaders.length > 0 || cards.candidatos.length > 0 || temMensagemSemResultado;
  return {
    tamanhoHtml: s.length,
    loaders: loaders.length,
    loaderTypes: loaders.map((l) => l.loaderType || "?"),
    queryHashes: loaders.length,
    cardsFinais: cards.candidatos.length,
    temMensagemSemResultado,
    pareceShell: !completa && (indicadoresShell || s.length < 5000),
    completa,
    _loaders: loaders,
    _cards: cards.candidatos,
  };
}

/* ---- RETENTATIVA DO GET api-produtos (bug: desistia no shell 200) ----
   Tentativa 1 imediata; 2 após 3s; 3 após +5s. AGREGA loaders/cards entre
   as tentativas (nunca descarta o que já coletou). */
export async function obterLoadersComRetentativa({
  buscarHtml,                       // (nTentativa) → html (lança em erro de rede)
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  esperasMs = [0, 3000, 5000],
}) {
  const loaders = new Map();        // pemId|hashId → loader (agregado)
  const cards = new Map();          // agregado de cards finais
  const analises = [];
  let zeroExplicito = false;
  for (let i = 0; i < esperasMs.length; i++) {
    if (esperasMs[i] > 0) await sleep(esperasMs[i]);
    const html = await buscarHtml(i + 1);
    const a = analisarHtmlBusca(html);
    analises.push({
      tentativaGet: i + 1, tamanhoHtml: a.tamanhoHtml, loaders: a.loaders,
      loaderTypes: a.loaderTypes, queryHashes: a.queryHashes, cardsFinais: a.cardsFinais,
      temMensagemSemResultado: a.temMensagemSemResultado, pareceShell: a.pareceShell,
    });
    log(analises[analises.length - 1]);
    for (const l of a._loaders) {
      const k = `${l.pemId}|${l.hashId}`;
      if (!loaders.has(k)) loaders.set(k, l);   // agrega; não descarta anteriores
    }
    for (const c of a._cards) {
      const k = `${c.id}|${c.urlImagemDireta}`;
      if (!cards.has(k)) cards.set(k, c);
    }
    if (a.temMensagemSemResultado) zeroExplicito = true;
    if (a.completa) break;                       // resposta real chegou
  }
  const teveConteudo = loaders.size > 0 || cards.size > 0;
  // zero explícito NUNCA convive com conteúdo coletado (loaders>0 ⇒ false)
  zeroExplicito = zeroExplicito && !teveConteudo;
  return {
    loaders: [...loaders.values()],
    cardsFinais: [...cards.values()],
    analises,
    tentativas: analises.length,
    zeroExplicito,
    // parcial = terminou SEM conteúdo e SEM "zero resultados" explícito → shell/lento
    parcial: !teveConteudo && !zeroExplicito,
  };
}

/* ---- classificação FINAL da falha de busca (nunca 'sem-candidato' com brutos=0) ---- */
export function classificarFalhaBusca(sinais = {}) {
  const s = {
    rede: 0, consultasRespondidas: 0, parcial: 0, urlsInvalidas: 0,
    candidatosAvaliados: 0, zeroExplicito: false, ...sinais,
  };
  if (s.consultasRespondidas === 0 && s.rede > 0) return "qrofertas-timeout";
  if (s.urlsInvalidas > 0) return "urls-invalidas";
  // definitivo SÓ com fluxo completo: zero explícito OU candidatos reais rejeitados
  if (s.zeroExplicito || s.candidatosAvaliados > 0) return "sem-candidato-confiavel";
  if (s.rede > 0) return "qrofertas-indisponivel";
  return "qrofertas-parcial"; // brutos=0 / shell / loaders pendentes → temporário
}

// tmp_produto (JSON do api-search-images) → candidato REAL para o matcher.
// Campos defensivos: nomes exatos confirmáveis via tools/capturar-qrofertas.mjs.
// campos alternativos de imagem observáveis no tmp_produto (ordem segura de
// preferência; NUNCA inventamos URL — só campos realmente presentes no JSON).
export const CAMPOS_IMAGEM_TMP = Object.freeze([
  "pem_thumb_s3", "pem_thumb", "pem_imagem", "thumb", "imagem", "url_imagem", "image", "foto",
]);

export function urlsDeImagemDoTmp(tmp) {
  const urls = [];
  for (const campo of CAMPOS_IMAGEM_TMP) {
    const v = tmp?.[campo];
    if (typeof v === "string" && /^https?:\/\//i.test(v) && !urls.includes(v)) urls.push(v);
  }
  return urls;
}

export function candidatoDeTmpProduto(tmp, fallback = {}) {
  if (!tmp || typeof tmp !== "object") return null;
  const titulo = String(
    tmp.pem_nome ?? tmp.nome ?? tmp.pem_descricao ?? tmp.descricao ?? tmp.name ?? ""
  ).trim();
  const urls = urlsDeImagemDoTmp(tmp);
  const id = tmp.pem_id ?? tmp.id ?? fallback.pemId ?? null;
  if (!urls.length) return null;               // sem URL direta de imagem → não é candidato
  if (titulo && !tituloValido(titulo)) return null; // texto de interface nunca vira candidato
  return {
    id,
    titulo: titulo || "(sem-titulo-no-json)",
    urlImagemDireta: urls[0],
    urls,                                       // TODAS as URLs candidatas (fallback técnico)
    descricao: String(tmp.pem_descricao ?? tmp.descricao ?? "").slice(0, 200) || null,
  };
}

/* Polling AGREGADOR (puro/testável) — QRofertas pode estar lento/instável:
   - continua enquanto houver loaders pendentes (wait_search/downloaded);
   - AGREGA os tmp_produto de todas as tentativas (nunca substitui anteriores);
   - timeout total 30s, intervalo 1s (fornecedor lento ≠ produto sem imagem). */
export async function resolverComPolling({
  loaders,
  resolver,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervaloMs = 1000,
  timeoutMs = 30000,
  maxTentativas = 30,
  now = () => Date.now(),
}) {
  const inicio = now();
  let tentativas = 0;
  const acumulado = new Map(); // chave por identidade do produto — nunca sobrescreve
  const chaveDe = (t, i) =>
    String(t?.pem_id ?? t?.id ?? "") + "|" + String(t?.pem_nome ?? t?.nome ?? "") + "|" +
    String(t?.pem_thumb_s3 ?? t?.pem_thumb ?? i);
  const alvo = loaders.length;
  while (tentativas < maxTentativas && now() - inicio < timeoutMs) {
    tentativas++;
    const r = await resolver(loaders);
    for (const [i, t] of (Array.isArray(r) ? r : []).entries()) {
      if (!t) continue;
      const k = chaveDe(t, i);
      if (!acumulado.has(k)) acumulado.set(k, t); // agrega; NÃO substitui
    }
    if (acumulado.size >= alvo) break;            // todos os loaders resolvidos
    if (now() - inicio + intervaloMs >= timeoutMs) break; // aborta limpo
    await sleep(intervaloMs);
  }
  const resolvidos = [...acumulado.values()];
  return {
    resolvidos,
    tentativas,
    pendentes: Math.max(0, alvo - resolvidos.length), // loaders que nunca responderam
    timeout:
      resolvidos.length < alvo &&
      (tentativas >= maxTentativas || now() - inicio >= timeoutMs),
  };
}

/* ---------------- tolerância a falha POR CONSULTA (bug 10122) ----------------
   Timeout/403/500/erro de rede em UMA consulta não pode encerrar a busca:
   registra, faz NO MÁXIMO uma repetição da mesma consulta (com backoff curto)
   e segue para a próxima consulta progressiva. */
export async function executarConsultasComTolerancia({
  consultas,
  executar,                 // (consulta) → resultado|null; lança em erro de rede
  log = () => {},
  backoffMs = 1500,
  maxRepeticaoPorConsulta = 1,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  for (const consulta of consultas || []) {
    for (let tent = 0; tent <= maxRepeticaoPorConsulta; tent++) {
      try {
        const r = await executar(consulta);
        if (r) return { resultado: r, consulta };
        break; // consulta respondeu mas sem resultado → próxima consulta (sem repetir)
      } catch (e) {
        log({ consulta, tentativa: tent + 1, erro: String(e?.message || e).slice(0, 100) });
        if (tent < maxRepeticaoPorConsulta) await sleep(backoffMs);
        // esgotou a repetição → segue para a PRÓXIMA consulta (nunca aborta o todo)
      }
    }
  }
  return { resultado: null, consulta: null };
}

/* ---------------- consultas progressivas (requisito 4) ----------------
   NUNCA remove volume/embalagem na primeira consulta.
   Ex.: COCA-COLA PET 2L →
     1) "coca cola pet 2l"
     2) "coca cola garrafa 2 litros"
     3) "coca cola 2l"
     4) "coca cola"
   CHA DE DENTRO BOVINO KG →
     1) "cha de dentro bovino kg"
     2) "cha de dentro bovino"
     3) "cha de dentro carne"                                      */
const EMB_SINONIMO = { pet: "garrafa", lata: "lata", cx: "caixa", pct: "pacote" };
const CORE_SINONIMO = { bovino: "carne", suino: "carne", bovina: "carne" };

export function montarConsultas(nome) {
  // remove qualificadores de temperatura/estado ("QU", "GELADA", "RESF"...)
  // de TODAS as consultas — eles não existem no banco de imagens.
  const reQualif = new RegExp(`\\b(${QUALIFICADORES_ESTADO.join("|")})\\b`, "g");
  const cheio = expandirAbreviacoes(
    norm(nome)
      .replace(/(\d),(\d)/g, "$1.$2")                // vírgula decimal → ponto (1,5L → 1.5L)
      .replace(/\b\d+\s*(?:mm|cm)\s*x\s*\d+\s*(?:mm|cm|m)?\b/g, " ") // dimensões (19mmx20m)
  )
    .replace(/(?<!\d)\.(?!\d)/g, " ")                  // remove pontos NÃO decimais (ex.: "TRAD.")
    .replace(/[^a-z0-9. ]+/g, " ")                   // preserva ponto decimal
    .replace(reQualif, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = [];
  const add = (q) => { const s = q.replace(/\s+/g, " ").trim(); if (s.length >= 3 && !out.includes(s)) out.push(s); };

  // 1) nome completo, preservando volume e embalagem
  add(cheio);

  // 2) sinônimos de embalagem + volume por extenso ("pet 2l" → "garrafa 2 litros")
  let v2 = cheio;
  for (const [de, para] of Object.entries(EMB_SINONIMO)) v2 = v2.replace(new RegExp(`\\b${de}\\b`, "g"), para);
  v2 = v2.replace(/\b(\d+(?:\.\d+)?)l\b/g, "$1 litros").replace(/\b(\d+(?:\.\d+)?) l\b/g, "$1 litros");
  add(v2);

  // 3) sem embalagem/unidade solta (mantém volume numérico); "kg" solto sai aqui
  add(cheio.replace(/\b(pet|lata|latao|garrafa|caixa|cx|pacote|pct|kg|un)\b/g, " "));

  // 3b) sinônimo de core (bovino→carne)
  let v3 = cheio.replace(/\b(kg|un)\b/g, " ");
  for (const [de, para] of Object.entries(CORE_SINONIMO)) v3 = v3.replace(new RegExp(`\\b${de}\\b`, "g"), para);
  add(v3);

  // 4) só o core (sem volume/embalagem/unidades)
  add(
    cheio
      .replace(/\b\d+(?:\.\d+)?\s*(kg|g|gr|l|lt|litros?|ml)\b/g, " ")
      .replace(/\b(pet|lata|latao|garrafa|caixa|cx|pacote|pct|kg|un|\d+)\b/g, " ")
  );
  return out.slice(0, 5);
}
