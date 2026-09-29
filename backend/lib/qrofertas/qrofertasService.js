import axios from "axios";
import { obterToken, forcarRelogin } from "./qrofertasAuth.js";
import { extrairTokens, escolherMelhor, ehPlaceholder } from "./lib/imagem-matcher.mjs";
import { validarImagemUrl, escolherUrlValida, criarFetchAxios } from "./lib/imagem-validador.mjs";
import { classificarMotivo, deveCachearFalha } from "./lib/imagem-retry.mjs";
import {
  extrairCandidatos,
  extrairLoaders,
  candidatoDeTmpProduto,
  resolverComPolling,
  montarConsultas,
  executarConsultasComTolerancia,
  obterLoadersComRetentativa,
  classificarFalhaBusca,
} from "./lib/qrofertas-extrator.mjs";

const fetchImagem = criarFetchAxios(axios);

/* =========================================================
   qrofertasService.js
   Busca imagem de produto no QRofertas pelo NOME.

   Fluxo de 2 passos (descoberto via DevTools):
   1. GET /services/api-produtos/?query=NOME
      -> HTML com data-pem_id e data-hash_id_s do(s) produto(s)
   2. POST /services/api-search-images/
      -> JSON com pem_thumb_s3 (a URL da imagem boa)
========================================================= */

const URL_PRODUTOS = "https://cdn.qrofertas.com/services/api-produtos/";
const URL_IMAGES = "https://cdn.qrofertas.com/services/api-search-images/";

const cache = new Map();
const QUARENTENA_MS = 7 * 24 * 60 * 60 * 1000;

const MIN_INTERVALO_MS = 1500;
let ultimaChamada = 0;

async function esperarRateLimit() {
  const agora = Date.now();
  const diff = agora - ultimaChamada;
  if (diff < MIN_INTERVALO_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVALO_MS - diff));
  }
  ultimaChamada = Date.now();
}

/* ---------- LIMPEZA DE NOME (B suavizado) ---------- */

function normalizarNome(nome) {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limparNomeParaBusca(nome) {
  let s = normalizarNome(nome);
  if (!s) return "";

  const abreviacoes = [
    [/\brech\b/g, "recheado"],
    [/\bint\b/g, "integral"],
    [/\bdesn\b/g, "desnatado"],
    [/\bsab\b/g, "sabao"],
    [/\bdet\b/g, "detergente"],
    [/\bol\b/g, "oleo"],
    [/\brefr\b/g, "refrigerante"],
    [/\biog\b/g, "iogurte"],
    [/\bsuc\b/g, "suco"],
    [/\bach\b/g, "achocolatado"],
    [/\bbisc\b/g, "biscoito"],
    [/\bchoc\b/g, "chocolate"],
    [/\bmarg\b/g, "margarina"],
    [/\bmant\b/g, "manteiga"],
    [/\bcond\b/g, "condicionador"],
    [/\bsham\b/g, "shampoo"],
    [/\bdesod\b/g, "desodorante"],
    [/\bcr\b/g, "creme"],
    [/\bag\b/g, "agua"],
    [/\bsalg\b/g, "salgado"],
    [/\btemp\b/g, "tempero"],
  ];
  for (const [re, novo] of abreviacoes) s = s.replace(re, novo);

  const padroesQuantidade = [
    /\b\d+[.,]?\d*\s*(kg|kgs|kilogramas?)\b/g,
    /\b\d+[.,]?\d*\s*(g|gr|grs|gramas?)\b/g,
    /\b\d+[.,]?\d*\s*(l|lt|lts|litros?)\b/g,
    /\b\d+[.,]?\d*\s*(ml|mls|mililitros?)\b/g,
    /\b\d+[.,]?\d*\s*(mt|mts|metros?)\b/g,
    /\b\d+[.,]?\d*\s*(cm|cms)\b/g,
    /\b\d+[.,]?\d*\s*(un|und|unidades?)\b/g,
    /\b\d+x\s*\d+\s*(mt|mts|cm|g|kg|ml|l|un)?\b/g,
    /\b\d+\s*x\s*\d+\b/g,
  ];
  for (const re of padroesQuantidade) s = s.replace(re, " ");

  const palavrasLixo = new Set([
    "pet", "lata", "garrafa", "cx", "caixa", "pct", "pacote", "rolo",
    "saco", "sache", "sachet", "bag", "frasco", "pote", "tubo",
    "tp", "tipo", "tradicional",
    "de", "da", "do", "das", "dos", "com", "sem", "e", "para", "p", "pra",
    "und", "un", "kg", "g", "l", "ml", "mt",
    "pre", "cozida", "cozido", "puro", "pura",
  ]);

  let palavras = s.replace(/[^\w\s]+/g, " ").split(/\s+/).filter(Boolean);
  palavras = palavras.filter((p) => !/^\d+$/.test(p));
  palavras = palavras.filter((p) => !palavrasLixo.has(p));
  palavras = palavras.filter((p) => p.length > 1);
  if (palavras.length > 5) palavras = palavras.slice(0, 5);
  return palavras.join(" ").trim();
}

/* ---------- PASSO 1: extrai pem_id e hash do HTML ---------- */

function extrairProdutoDoHtml(html) {
  if (typeof html !== "string" || !html) return null;

  // Procura tags <div ...> que tenham AMBOS data-pem_id e data-hash_id_s.
  const reBlocoProduto =
    /<div[^>]+(data-(?:pem_id|hash_id_s)="[^"]+")[^>]+(data-(?:pem_id|hash_id_s)="[^"]+")[^>]*>/gi;

  const matches = html.match(reBlocoProduto) || [];

  for (const tag of matches) {
    const mPemId = tag.match(/data-pem_id="(\d+)"/);
    const mHashId = tag.match(/data-hash_id_s="([a-f0-9]+)"/);

    if (mPemId && mHashId && Number(mPemId[1]) > 0) {
      return {
        pemId: Number(mPemId[1]),
        hashId: mHashId[1],
      };
    }
  }
  return null;
}

async function passoUmBuscarProduto(query, jwt, tentativaRelogin = false) {
  const url = `${URL_PRODUTOS}?query=${encodeURIComponent(query)}&noCorrection=true`;
  try {
    const resp = await axios.get(url, {
      headers: {
        Cookie: `AUTHORIZATION=${jwt}`,
        "User-Agent": "MultigiroBot/1.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://cdn.qrofertas.com/criar-jornal/builder-v2/",
      },
      timeout: 20000,
    });
    return extrairProdutoDoHtml(resp.data);
  } catch (e) {
    const status = e.response?.status;
    if ((status === 401 || status === 403) && !tentativaRelogin) {
      console.log("⚠️  api-produtos retornou", status, "— relogando");
      const novoJwt = await forcarRelogin();
      return passoUmBuscarProduto(query, novoJwt, true);
    }
    throw e;
  }
}

/* ---------- PASSO 2: pega imagem usando pem_id + hash ---------- */

async function passoDoisPegarImagem(pemId, hashId, jwt, tentativaRelogin = false) {
  const querysArr = [
    {
      QUERY_HASH_ID_s: hashId,
      loader_type: "WAIT_SEARCH",
      ignorecorrection: false,
      loader_type_target: `.WAIT_SEARCH-${hashId}-0`,
      pem_id: pemId,
    },
  ];

  const form = new URLSearchParams();
  form.append("QUERYS", JSON.stringify(querysArr));
  form.append("isMultiProducts", "false");

  try {
    const resp = await axios.post(URL_IMAGES, form.toString(), {
      headers: {
        Cookie: `AUTHORIZATION=${jwt}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "User-Agent": "MultigiroBot/1.0",
        Referer: "https://cdn.qrofertas.com/criar-jornal/builder-v2/",
      },
      timeout: 20000,
    });

    const data = resp.data;
    if (!data || typeof data !== "object") return null;

    for (const k of Object.keys(data)) {
      const item = data[k];
      const tmp = item?.tmp_produto;
      if (tmp) {
        if (tmp.pem_thumb_s3) return tmp.pem_thumb_s3;
        if (tmp.pem_thumb) return tmp.pem_thumb;
      }
    }
    return null;
  } catch (e) {
    const status = e.response?.status;
    if ((status === 401 || status === 403) && !tentativaRelogin) {
      console.log("⚠️  api-search-images retornou", status, "— relogando");
      const novoJwt = await forcarRelogin();
      return passoDoisPegarImagem(pemId, hashId, novoJwt, true);
    }
    throw e;
  }
}

/* ---------- PASSO 1B: HTML bruto da busca (extração fica no extrator) ---------- */

async function passoUmTodosCandidatos(query, jwt, tentativaRelogin = false) {
  const url = `${URL_PRODUTOS}?query=${encodeURIComponent(query)}&noCorrection=true`;
  try {
    const resp = await axios.get(url, {
      headers: {
        Cookie: `AUTHORIZATION=${jwt}`,
        "User-Agent": "MultigiroBot/1.0",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://cdn.qrofertas.com/criar-jornal/builder-v2/",
      },
      timeout: 20000,
    });
    return String(resp.data || "");
  } catch (e) {
    const status = e.response?.status;
    if ((status === 401 || status === 403) && !tentativaRelogin) {
      const novoJwt = await forcarRelogin();
      return passoUmTodosCandidatos(query, novoJwt, true);
    }
    throw e;
  }
}

/* ---------- PASSO 2B: resolve LOADERS via api-search-images (fluxo real) ----------
   Mesmo POST que o fluxo antigo usava para chegar à imagem final; aqui pedimos
   TODOS os loaders de uma vez e devolvemos os tmp_produto completos (nome +
   pem_thumb_s3), que então viram candidatos reais. */
async function resolverLoadersHttp(loaders, jwt) {
  const querys = loaders
    .filter((l) => l.pemId && l.hashId)
    .map((l) => ({
      QUERY_HASH_ID_s: l.hashId,
      loader_type: (l.loaderType || "wait_search").toUpperCase(),
      ignorecorrection: false,
      loader_type_target: `.${(l.loaderType || "wait_search").toUpperCase()}-${l.hashId}-0`,
      pem_id: l.pemId,
    }));
  if (!querys.length) return [];
  const form = new URLSearchParams();
  form.append("QUERYS", JSON.stringify(querys));
  form.append("isMultiProducts", querys.length > 1 ? "true" : "false");
  const resp = await axios.post(URL_IMAGES, form.toString(), {
    headers: {
      Cookie: `AUTHORIZATION=${jwt}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent": "MultigiroBot/1.0",
      Referer: "https://cdn.qrofertas.com/criar-jornal/builder-v2/",
    },
    timeout: 20000,
  });
  const data = resp.data;
  const tmps = [];
  if (data && typeof data === "object") {
    for (const k of Object.keys(data)) {
      const tmp = data[k]?.tmp_produto;
      if (tmp) tmps.push(tmp);
    }
  }
  return tmps;
}

/* ---------- FUNÇÃO PRINCIPAL ----------
   Escolha CONFIÁVEL (incidentes Coca PET 2L/lata e Chã de Dentro 404):
   1) tokens críticos do nome (marca/produto/volume/embalagem/variante);
   2) TODOS os candidatos avaliados por score (conflito de volume/embalagem
      rejeita explicitamente);
   3) URL validada tecnicamente (2xx, image/*, corpo>0, timeout, redirects)
      ANTES de ser devolvida — nunca placeholder.
   Sem candidato confiável → null (o chamador marca imagePending).
   Logs: código/consulta/candidato/score/motivos — sem cookies/credenciais. */

export async function buscarImagemPorNome(nome, contexto = {}) {
  const codigo = contexto.codigo ?? "?";
  const chave = String(nome || "").toLowerCase().trim();
  if (!chave || chave.length < 3) return { url: null, motivo: "sem-candidato-confiavel" };

  const cached = cache.get(chave);
  if (cached) {
    if (cached.url) return { url: cached.url, motivo: null };
    // quarentena longa SÓ para falha definitiva; temporárias nunca entram aqui
    if (Date.now() - cached.triedAt < QUARENTENA_MS)
      return { url: null, motivo: cached.motivo || "sem-candidato-confiavel" };
  }

  // sinais para classificar a falha no fim (fornecedor lento ≠ sem imagem)
  const sinais = {
    rede: 0, parcial: 0, urlsInvalidas: 0, consultasRespondidas: 0,
    candidatosAvaliados: 0,   // candidatos REAIS que chegaram ao matcher
    zeroExplicito: false,     // página disse claramente "nenhum resultado"
  };

  let jwt;
  try {
    jwt = await obterToken();
  } catch (e) {
    // login falhou → indisponibilidade TEMPORÁRIA do fornecedor (sem quarentena)
    const motivo = classificarMotivo("login " + e.message);
    console.warn(`🖼️  [${codigo}] login QRofertas falhou → motivo=${motivo} (retentativa curta)`);
    return { url: null, motivo };
  }
  const tokens = extrairTokens(nome);

  // coleta TODOS os candidatos de uma consulta (loaders com polling agregador 30s/1s)
  const coletarCandidatos = async (consulta) => {
    // GET api-produtos com RETENTATIVA (0s, +3s, +5s): 200 pode vir como SHELL
    // (template com data-attrs vazios) quando o QRofertas está lento.
    const ret = await obterLoadersComRetentativa({
      buscarHtml: async (tentativaGet) => {
        await esperarRateLimit();
        return passoUmTodosCandidatos(consulta, jwt);
      },
      log: (a) =>
        console.log(
          `🖼️  [${codigo}] consulta="${consulta}" GET#${a.tentativaGet} html=${a.tamanhoHtml}B ` +
            `loaders=${a.loaders}(${a.loaderTypes.join(",") || "-"}) cardsFinais=${a.cardsFinais} ` +
            `zeroExplicito=${a.temMensagemSemResultado} shell=${a.pareceShell}`
        ),
    });
    if (ret.zeroExplicito) sinais.zeroExplicito = true;

    let candidatos = [...ret.cardsFinais];
    let parcial = ret.parcial;
    if (ret.loaders.length) {
      const { resolvidos, tentativas, pendentes, timeout } = await resolverComPolling({
        loaders: ret.loaders,
        resolver: (ls) => resolverLoadersHttp(ls, jwt),
        intervaloMs: 1000,
        timeoutMs: 30000,
      });
      const doPolling = resolvidos
        .map((tmp, i) => candidatoDeTmpProduto(tmp, ret.loaders[i] || {}))
        .filter(Boolean);
      candidatos = candidatos.concat(doPolling);
      parcial = parcial || pendentes > 0 || timeout;
      console.log(
        `🖼️  [${codigo}] consulta="${consulta}" loaders=${ret.loaders.length} resolvidos=${resolvidos.length} ` +
          `pendentes=${pendentes} candidatosReais=${candidatos.length} tentativasPolling=${tentativas}` +
          (timeout ? " TIMEOUT-POLLING" : "")
      );
    } else {
      console.log(
        `🖼️  [${codigo}] consulta="${consulta}" getsTentados=${ret.tentativas} candidatosReais=${candidatos.length}` +
          (parcial ? " RESPOSTA-PARCIAL(shell)" : "") + (ret.zeroExplicito ? " ZERO-EXPLICITO" : "")
      );
    }
    return { candidatos, parcial, zeroExplicito: ret.zeroExplicito };
  };

  // matcher + validação técnica de TODAS as URLs distintas de TODOS os aceitos
  const validarLote = async (candidatos) => {
    if (!candidatos.length) return { escolhido: null, aceitosCount: 0 };
    const comUrl = candidatos.map((c) => ({
      rotulo: c.titulo, url: c.urlImagemDireta, urls: c.urls || [c.urlImagemDireta], idResultado: c.id,
    }));
    const { avaliados } = escolherMelhor(tokens, comUrl);
    sinais.candidatosAvaliados += avaliados.length; // candidatos REAIS chegaram ao matcher
    for (const a of avaliados) {
      console.log(
        `🖼️  [${codigo}]   candidato id=${a.idResultado} "${String(a.rotulo).slice(0, 60)}" ` +
          `score=${a.avaliacao.score} aceito=${a.avaliacao.aceito}` +
          (a.avaliacao.motivos.length ? ` motivos=${a.avaliacao.motivos.join("|")}` : "")
      );
    }
    const aceitos = avaliados.filter((a) => a.avaliacao.aceito && !ehPlaceholder(a.url));
    if (!aceitos.length) return { escolhido: null, aceitosCount: 0 };
    const { escolhido, tentativas } = await escolherUrlValida({
      aceitos,
      validar: (url) => validarImagemUrl(url, { fetchImpl: fetchImagem }),
      log: (t) =>
        console.log(
          `🖼️  [${codigo}]   URL#${t.urlTentativa} "${String(t.titulo).slice(0, 45)}" score=${t.score} ` +
            `status=${t.status ?? "-"} ct=${t.contentTypeInformado ?? "-"} assinatura=${t.tipoDetectado ?? "-"} ` +
            `bytes=${t.bytes ?? "-"}` + (t.motivoRejeicao ? ` REJEITADA: ${t.motivoRejeicao}` : " ✓ ACEITA")
        ),
    });
    if (!escolhido)
      console.log(`🖼️  [${codigo}]   ${tentativas.length} URL(s) distinta(s) testadas — nenhuma válida`);
    return { escolhido, aceitosCount: aceitos.length };
  };

  const chaveCand = (c) => `${c.titulo}|${(c.urls || [])[0] || c.urlImagemDireta}`;

  const executarConsulta = async (consulta) => {
    let { candidatos, parcial } = await coletarCandidatos(consulta);
    sinais.consultasRespondidas++;
    if (parcial) sinais.parcial++;

    let r = await validarLote(candidatos);
    if (!r.escolhido && (r.aceitosCount > 0 || parcial)) {
      // resposta parcial OU só URLs inválidas: aguarda 3s e repete a consulta
      // completa UMA vez, AGREGANDO os novos candidatos aos anteriores.
      if (r.aceitosCount > 0) sinais.urlsInvalidas++;
      console.log(`🖼️  [${codigo}] resposta parcial/URLs inválidas — aguardando 3s e repetindo a consulta (agregando)`);
      await new Promise((res) => setTimeout(res, 3000));
      const seg = await coletarCandidatos(consulta);
      if (seg.parcial) sinais.parcial++;
      const mapa = new Map(candidatos.map((c) => [chaveCand(c), c]));
      for (const c of seg.candidatos) if (!mapa.has(chaveCand(c))) mapa.set(chaveCand(c), c);
      candidatos = [...mapa.values()];
      r = await validarLote(candidatos); // revalida TODAS as URLs distintas do agregado
      if (!r.escolhido && r.aceitosCount > 0) sinais.urlsInvalidas++;
    }
    if (r.escolhido) {
      const v = r.escolhido.validacao;
      console.log(
        `🖼️  [${codigo}] imagem ACEITA (consulta="${consulta}") score=${r.escolhido.avaliacao.score} ` +
          `assinatura=${v.tipoDetectado} ${v.bytes}B url=${r.escolhido.urlValidada}`
      );
      return r.escolhido.urlValidada;
    }
    return null;
  };

  try {
    const { resultado } = await executarConsultasComTolerancia({
      consultas: montarConsultas(nome),
      executar: executarConsulta,
      log: (f) => {
        sinais.rede++;
        console.warn(`🖼️  [${codigo}] consulta="${f.consulta}" tentativa ${f.tentativa} FALHOU (${f.erro}) — seguindo`);
      },
    });
    if (resultado) {
      cache.set(chave, { url: resultado, triedAt: Date.now() });
      return { url: resultado, motivo: null };
    }

    // classificação FINAL (pura, testada): 'sem-candidato-confiavel' SÓ com
    // fluxo completo (zero explícito OU candidatos reais rejeitados pelo matcher)
    const motivo = classificarFalhaBusca(sinais);

    if (deveCachearFalha(motivo)) {
      cache.set(chave, { url: null, triedAt: Date.now(), motivo }); // quarentena só p/ definitivo
    } else {
      console.log(`🖼️  [${codigo}] falha TEMPORÁRIA (${motivo}) — SEM quarentena; cooldown curto decide a retentativa`);
    }
    console.log(`🖼️  [${codigo}] resultado: sem imagem — motivo=${motivo}`);
    return { url: null, motivo };
  } catch (e) {
    const motivo = classificarMotivo(e.message);
    console.warn(`   ⚠️  [${codigo}] Erro buscando "${chave}": ${e.message} → motivo=${motivo}`);
    return { url: null, motivo };
  }
}

/* ---------- HELPERS DE DEBUG ---------- */

export function statsCacheQRofertas() {
  let comUrl = 0;
  let semUrl = 0;
  for (const v of cache.values()) {
    if (v.url) comUrl++;
    else semUrl++;
  }
  return { total: cache.size, comUrl, semUrl };
}

export function limparCacheQRofertas() {
  cache.clear();
}

export function debugLimparNome(nome) {
  return limparNomeParaBusca(nome);
}

export async function debugBuscarCompleto(nome) {
  const chave = limparNomeParaBusca(nome);
  if (!chave || chave.length < 3) {
    return { erro: "nome muito curto após limpeza", chave };
  }
  try {
    const jwt = await obterToken();
    await esperarRateLimit();

    const produto = await passoUmBuscarProduto(chave, jwt);
    if (!produto) {
      return {
        chave,
        passo1: "nenhum produto encontrado no HTML",
        passo2: "(não executado)",
        url: null,
      };
    }

    const url = await passoDoisPegarImagem(produto.pemId, produto.hashId, jwt);

    return {
      chave,
      passo1: produto,
      passo2: url ? "imagem encontrada" : "imagem não veio no JSON",
      url,
    };
  } catch (e) {
    return { erro: e.message };
  }
}
/* =========================================================
   ADIÇÃO (gerador de encartes): lista de candidatos para escolha manual.
   Mesmo fluxo de coleta de buscarImagemPorNome (consultas progressivas,
   retentativa do GET, polling dos loaders, extrator) e mesma avaliação do
   matcher; devolve TODOS os candidatos com score/motivos em vez de escolher
   um. Sem cache/quarentena e sem validação de bytes aqui (o proxy de imagem
   valida a assinatura ao exibir).
========================================================= */
export async function listarCandidatosPorNome(nome, contexto = {}) {
  const codigo = contexto.codigo ?? "?";
  const minimo = contexto.minimo ?? 6;
  const jwt = await obterToken();
  const tokens = extrairTokens(nome);
  const mapa = new Map();
  const consultasFeitas = [];
  for (const consulta of montarConsultas(nome)) {
    try {
      const ret = await obterLoadersComRetentativa({
        buscarHtml: async () => { await esperarRateLimit(); return passoUmTodosCandidatos(consulta, jwt); },
      });
      let candidatos = [...ret.cardsFinais];
      if (ret.loaders.length) {
        const { resolvidos } = await resolverComPolling({
          loaders: ret.loaders, resolver: (ls) => resolverLoadersHttp(ls, jwt), intervaloMs: 1000, timeoutMs: 20000,
        });
        candidatos = candidatos.concat(
          resolvidos.map((tmp, i) => candidatoDeTmpProduto(tmp, ret.loaders[i] || {})).filter(Boolean)
        );
      }
      for (const c of candidatos) {
        const k = `${c.titulo}|${(c.urls || [])[0] || c.urlImagemDireta}`;
        if (!mapa.has(k)) mapa.set(k, c);
      }
      consultasFeitas.push({ consulta, candidatos: candidatos.length });
      console.log(`🖼️  [${codigo}] candidatos consulta="${consulta}" → ${candidatos.length} (acumulado ${mapa.size})`);
    } catch (e) {
      consultasFeitas.push({ consulta, erro: String(e?.message || e).slice(0, 100) });
      console.warn(`🖼️  [${codigo}] candidatos consulta="${consulta}" FALHOU (${e?.message || e})`);
    }
    if (mapa.size >= minimo) break;
  }
  const comUrl = [...mapa.values()].map((c) => ({
    rotulo: c.titulo, url: c.urlImagemDireta, urls: c.urls || [c.urlImagemDireta], idResultado: c.id,
  }));
  const { avaliados } = escolherMelhor(tokens, comUrl);
  const candidatos = avaliados
    .filter((a) => a.url && !ehPlaceholder(a.url))
    .map((a) => ({ id: a.idResultado, titulo: a.rotulo, url: a.url, urls: a.urls, score: a.avaliacao.score, aceito: a.avaliacao.aceito, motivos: a.avaliacao.motivos }))
    .sort((a, b) => (Number(b.aceito) - Number(a.aceito)) || (b.score - a.score));
  return { tokens, consultas: consultasFeitas, candidatos };
}
