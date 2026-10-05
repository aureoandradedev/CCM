/* =========================================================================
   imagem-matcher.mjs — escolha CONFIÁVEL de imagem (QRofertas) — lógica pura
   ==========================================================================
   Incidentes que motivaram este módulo (produção, 23-24/07/2026):
   - COCA-COLA PET 2L recebeu foto de LATA (embalagem/volume ignorados);
   - CHÃ DE DENTRO BOVINO KG recebeu URL que não carrega (sem validação técnica).

   Regras: marca+produto principal obrigatórios; volume/peso EXATO obrigatório
   quando o nome informa; embalagem obrigatória quando o nome informa; qualquer
   embalagem/volume CONFLITANTE rejeita explicitamente; placeholder/mascote
   nunca conta como imagem real. Sem resultado confiável → sem imagem
   (imagePending:true — o placeholder é papel do frontend).
========================================================================= */

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// grupos de embalagem: tokens do mesmo grupo são compatíveis entre si;
// grupos diferentes CONFLITAM.
const EMBALAGENS = [
  { grupo: "pet", tokens: ["pet", "garrafa", "gf", "grf"] },
  { grupo: "lata", tokens: ["lata", "latao", "lt", "ln"] },
  { grupo: "caixa", tokens: ["caixa", "cx", "tetra", "tp"] },
  { grupo: "pacote", tokens: ["pacote", "pct", "sache", "sachet", "saco"] },
  { grupo: "pote", tokens: ["pote", "frasco", "tubo"] },
  { grupo: "bandeja", tokens: ["bandeja", "bdj"] },
];
const TOKEN_PARA_GRUPO = new Map();
for (const e of EMBALAGENS) for (const t of e.tokens) TOKEN_PARA_GRUPO.set(t, e.grupo);

// Qualificadores de temperatura/estado do ERP (ex.: "COCA-COLA PET 2L QU"):
// existem só no nome comercial interno — NUNCA entram no core crítico da
// busca/comparação de imagem nem nas consultas, e não causam rejeição de
// candidato. O nome salvo no Firestore permanece intacto (isto é só matching).
export const QUALIFICADORES_ESTADO = Object.freeze([
  "qu", "quente", "gel", "gelada", "gelado", "resf", "resfriada", "resfriado",
]);

// palavras que não identificam o produto (não entram nos tokens obrigatórios)
// Inclui prefixos de CATEGORIA do ERP ("refri"→"refrigerante", "cerv"→"cerveja"):
// QROfertas devolve "COCA COLA ZERO PET 1.5L" (sem "refrigerante"), então exigir
// a palavra de categoria rejeitaria candidatos válidos.
const IRRELEVANTES = new Set([
  ...QUALIFICADORES_ESTADO,
  "de", "da", "do", "das", "dos", "com", "sem", "e", "para", "p", "tipo", "tp",
  "un", "und", "unidade", "kg", "g", "l", "ml", "cada", "aprox",
  "refrigerante", "refri", "refr", "cerveja", "cerv",
  ...[...TOKEN_PARA_GRUPO.keys()],
]);

/* Abreviações do ERP Uniplus que o QRofertas não entende.
   Expandidas ANTES da tokenização e na montagem de consultas.
   Ordem importa: "refr" antes de verificar "refri" (se houvesse sobreposição). */
export const ABREVIACOES_ERP = Object.freeze([
  ["refri", "refrigerante"],
  ["refr", "refrigerante"],
  ["cerv", "cerveja"],
  ["desn", "desnatado"],
  ["rech", "recheado"],
  ["int", "integral"],
  ["sab", "sabao"],
  ["det", "detergente"],
  ["ol", "oleo"],
  ["iog", "iogurte"],
  ["suc", "suco"],
  ["ach", "achocolatado"],
  ["bisc", "biscoito"],
  ["choc", "chocolate"],
  ["marg", "margarina"],
  ["mant", "manteiga"],
  ["cond", "condicionador"],
  ["sham", "shampoo"],
  ["desod", "desodorante"],
  ["cr", "creme"],
  ["ag", "agua"],
  ["salg", "salgado"],
  ["temp", "tempero"],
  ["trad", "tradicional"],
]);

/** Expande abreviações do ERP em um texto normalizado (lowercase sem acentos). */
export function expandirAbreviacoes(texto) {
  let s = texto;
  for (const [de, para] of ABREVIACOES_ERP) {
    s = s.replace(new RegExp(`\\b${de}\\b`, "g"), para);
  }
  return s;
}

/* Padrão de dimensão do ERP (ex.: 19MMX20M, 10CMX5M) — não identifica produto. */
const RE_DIMENSAO = /\b\d+\s*(?:mm|cm|m)\s*x\s*\d+\s*(?:mm|cm|m)?\b/gi;

// volume/peso → valor normalizado (ml ou g); "2l"→{ml:2000}, "350ml", "1kg"→{g:1000}
export function extrairVolume(texto) {
  const t = norm(texto)
    .replace(/(\d),(\d)/g, "$1.$2")
    // TP1/TIPO 1 = classificação do produto, NÃO parte do peso.
    // Colapsa espaço "tp 1" → "tp1" para que o decimal-join não junte "1 1Kg" em "1.1Kg".
    // Mantém "tp" intacto para detecção de embalagem (caixa).
    .replace(/\b(tp|tipo)\s+(\d)/g, "$1$2")
    // QROfertas retorna decimal separado por espaço: "1 5L" = 1.5L, "1 35L" = 1.35L.
    // Conservador: SÓ quando a parte inteira é 1 dígito, a fracionária 1-2 dígitos,
    // e imediatamente seguido de unidade de volume/peso. Isso evita falsos positivos
    // como "pack 12 500ml" (12 tem 2 dígitos → não casa).
    .replace(/\b(\d)\s(\d{1,2})\s*(kg|g|gr|l|lt|litros?|ml)\b/g, "$1.$2$3");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|gr|l|lt|litros?|ml)\b/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2];
  if (u === "kg") return { tipo: "peso", valor: v * 1000 };        // g
  if (u === "g" || u === "gr") return { tipo: "peso", valor: v };  // g
  if (u === "ml") return { tipo: "volume", valor: v };             // ml
  return { tipo: "volume", valor: v * 1000 };                      // l/lt/litro → ml
}

export function extrairEmbalagem(texto) {
  // Remove expressões de volume ANTES de procurar embalagem.
  // Sem isso, "1.47 LT PET" encontra "lt" (lata) antes de "pet" (garrafa).
  const semVolume = norm(texto)
    .replace(/(\d),(\d)/g, "$1.$2")
    // "tp 1" / "tp1" → "tp" — remove dígito de classificação, mantém "tp" para
    // detecção de embalagem (caixa). Diferente do collapse usado em extrairVolume
    // porque aqui precisamos que "tp" continue como token reconhecível.
    .replace(/\b(tp|tipo)\s*\d+/g, "$1")
    .replace(/\b(\d)\s(\d{1,2})\s*(kg|g|gr|l|lt|litros?|ml)\b/g, "$1.$2$3") // "1 5l" → "1.5l"
    .replace(/\b(\d+(?:\.\d+)?)\s*(kg|g|gr|l|lt|litros?|ml)\b/g, " ");
  // "lt" é ambíguo (litro vs lata): se há token explícito (pet, garrafa, etc.),
  // o explícito prevalece. Se "lt" é o único token de embalagem → lata.
  let temLt = false;
  for (const w of semVolume.split(/[^a-z0-9]+/)) {
    const g = TOKEN_PARA_GRUPO.get(w);
    if (g) {
      if (w === "lt") { temLt = true; continue; }
      return g;
    }
  }
  if (temLt) return "lata";
  return null;
}

// tokens críticos do NOME do produto (Uniplus)
export function extrairTokens(nome) {
  const n = norm(nome);
  const volume = extrairVolume(n);
  const embalagem = extrairEmbalagem(n);
  const palavras = expandirAbreviacoes(n)
    .replace(RE_DIMENSAO, " ")                                       // dimensões (19mmx20m)
    .replace(/(\d),(\d)/g, "$1.$2")                                  // vírgula decimal
    .replace(/\b(tp|tipo)\s+(\d)/g, "$1$2")                         // "tp 1" → "tp1" (classificação)
    .replace(/\b(\d)\s(\d{1,2})\s*(kg|g|gr|l|lt|litros?|ml)\b/g, "$1.$2$3") // "1 5l"→"1.5l"
    .replace(/(\d+(?:\.\d+)?)\s*(kg|g|gr|l|lt|litros?|ml)\b/g, " ") // volume/peso
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2 && !IRRELEVANTES.has(w));
  // heurística: 1ª palavra significativa = produto/marca principal; todas são obrigatórias
  return {
    original: String(nome || ""),
    core: palavras,            // marca + produto + variante/sabor (todas obrigatórias)
    principal: palavras[0] || null,
    volume,                    // {tipo, valor} normalizado ou null
    embalagem,                 // grupo ("pet","lata",...) ou null
  };
}

export function ehPlaceholder(url) {
  return /placeholder|mascote|no-?image|sem-?imagem|default\.(png|jpe?g|webp)|logo/i.test(String(url || ""));
}

// avalia um candidato { rotulo, url } contra os tokens do produto
export function avaliarCandidato(tokens, candidato) {
  const rotulo = norm(candidato?.rotulo || "");
  const motivos = [];
  const incompativeis = [];

  if (!rotulo || rotulo.length < 3) {
    return { aceito: false, score: 0, motivos: ["rotulo-ilegivel"], incompativeis };
  }
  if (ehPlaceholder(candidato?.url)) {
    return { aceito: false, score: 0, motivos: ["url-placeholder"], incompativeis };
  }

  // 1) marca + produto principal: TODAS as palavras core obrigatórias
  const faltantes = tokens.core.filter((w) => !rotulo.includes(w));
  if (faltantes.length) {
    incompativeis.push(...faltantes);
    motivos.push(`core-ausente:${faltantes.join(",")}`);
  }

  // 2) volume/peso exato obrigatório quando informado (e conflito rejeita)
  const volCand = extrairVolume(rotulo);
  if (tokens.volume) {
    if (!volCand) motivos.push("volume-nao-confirmado-no-candidato");
    else if (volCand.tipo !== tokens.volume.tipo || volCand.valor !== tokens.volume.valor) {
      incompativeis.push(`volume:${volCand.valor}${volCand.tipo === "peso" ? "g" : "ml"}`);
      motivos.push("volume-conflitante");
    }
  }

  // 3) embalagem obrigatória quando informada (e conflito rejeita)
  const embCand = extrairEmbalagem(rotulo);
  if (tokens.embalagem) {
    if (!embCand) motivos.push("embalagem-nao-confirmada-no-candidato");
    else if (embCand !== tokens.embalagem) {
      incompativeis.push(`embalagem:${embCand}`);
      motivos.push("embalagem-conflitante");
    }
  } else if (embCand && volCand && tokens.volume && volCand.valor !== tokens.volume.valor) {
    motivos.push("embalagem-inesperada-com-volume-divergente");
  }

  const aceito = motivos.length === 0;
  // score informativo: fração de core presente + bônus volume/embalagem confirmados
  const coreOk = tokens.core.length ? (tokens.core.length - faltantes.length) / tokens.core.length : 0;
  const score = Math.round(
    (coreOk * 60 +
      (tokens.volume ? (volCand && volCand.valor === tokens.volume.valor ? 25 : 0) : 25) +
      (tokens.embalagem ? (embCand === tokens.embalagem ? 15 : 0) : 15))
  );
  return { aceito, score, motivos, incompativeis };
}

export function escolherMelhor(tokens, candidatos) {
  const avaliados = (candidatos || []).map((c) => ({ ...c, avaliacao: avaliarCandidato(tokens, c) }));
  const aceitos = avaliados.filter((c) => c.avaliacao.aceito);
  aceitos.sort((a, b) => b.avaliacao.score - a.avaliacao.score);
  return { escolhido: aceitos[0] || null, avaliados };
}

// decide os campos de imagem a gravar no doc — NUNCA sobrescreve imageManual=true
// e NUNCA grava placeholder. Sem resultado confiável → imagePending:true.
export function decidirCamposImagem({ atual, urlValidada }) {
  if (atual?.imageManual === true) return {}; // intocável
  if (atual?.img) return {};                  // imagem existente nunca é sobrescrita
  if (urlValidada && !ehPlaceholder(urlValidada)) {
    return { img: urlValidada, imageSource: "qrofertas", imageFetchedAt: Date.now(), imagePending: false };
  }
  return { imageSource: null, imageManual: atual?.imageManual === true ? true : false, imagePending: true };
}
