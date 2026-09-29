/* =========================================================================
   imagem-validador.mjs — validação TÉCNICA da URL antes de gravar no doc
   ==========================================================================
   Ajustes de produção (24/07):
   - S3 devolve .png com Content-Type binary/octet-stream → validar pela
     ASSINATURA REAL dos bytes (PNG/JPEG/GIF/WebP), nunca só pelo header e
     nunca octet-stream apenas pela extensão;
   - GET real (não HEAD), até 3 redirects, timeout 15s, limite 5 MB com
     interrupção do download;
   - fallback ordenado: tenta TODAS as URLs distintas dos candidatos aceitos
     (por score) antes de desistir — 403/404/timeout/conteúdo inválido pula
     para a próxima, SEM tentar burlar controle de acesso.
========================================================================= */

export const TAMANHO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Assinaturas: PNG 89 50 4E 47 0D 0A 1A 0A | JPEG FF D8 FF | GIF87a/GIF89a | RIFF....WEBP
export function detectarTipoImagem(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  const ascii = (s, o = 0) => {
    for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (ascii("GIF87a") || ascii("GIF89a")) return "gif";
  if (ascii("RIFF") && ascii("WEBP", 8)) return "webp";
  return null;
}

const CT_ACEITAVEL = (ct) => {
  const c = String(ct || "").toLowerCase();
  return c === "" || c.startsWith("image/") ||
    c.startsWith("application/octet-stream") || c.startsWith("binary/octet-stream");
};

/**
 * fetchImpl(url, {timeoutMs, maxRedirects, maxBytes}) →
 *   { status, contentType, bytes, corpo (Buffer/Uint8Array — primeiros bytes) }
 * Lança em timeout/rede; erro de limite deve conter "maxContentLength"/"limite".
 */
export async function validarImagemUrl(url, opts = {}) {
  const { fetchImpl, timeoutMs = 15000, maxRedirects = 3, maxBytes = TAMANHO_MAX_BYTES } = opts;
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, motivo: "url-invalida" };
  }
  let resp;
  try {
    resp = await fetchImpl(url, { timeoutMs, maxRedirects, maxBytes });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/maxContentLength|limite|content length/i.test(msg)) return { ok: false, motivo: "tamanho-excedido" };
    return { ok: false, motivo: /timeout|aborted|ECONNABORTED/i.test(msg) ? "timeout" : `inacessivel:${msg.slice(0, 80)}` };
  }
  if (!(resp.status >= 200 && resp.status < 300)) return { ok: false, motivo: `http-${resp.status}`, status: resp.status };
  const ct = String(resp.contentType || "").toLowerCase();
  if (!CT_ACEITAVEL(ct)) return { ok: false, motivo: `content-type-nao-imagem:${ct || "(vazio)"}`, status: resp.status, contentType: ct };
  if (!Number(resp.bytes)) return { ok: false, motivo: "corpo-vazio", status: resp.status, contentType: ct };
  if (Number(resp.bytes) > maxBytes) return { ok: false, motivo: "tamanho-excedido", status: resp.status, contentType: ct, bytes: resp.bytes };

  // ASSINATURA REAL obrigatória — mesmo p/ image/* e mesmo com extensão .png
  const tipo = detectarTipoImagem(resp.corpo);
  if (!tipo) {
    return { ok: false, motivo: `assinatura-desconhecida (content-type informado: ${ct || "(vazio)"})`, status: resp.status, contentType: ct, bytes: resp.bytes };
  }
  return { ok: true, status: resp.status, contentType: ct, tipoDetectado: tipo, bytes: Number(resp.bytes) };
}

/* Fallback ordenado (puro/testável): candidatos ACEITOS pelo matcher, do maior
   score para o menor; cada um pode ter várias URLs (campos alternativos do
   tmp_produto); URLs duplicadas testadas UMA vez; termina sem imagem só depois
   de testar todas as URLs distintas. */
export async function escolherUrlValida({ aceitos, validar, log = () => {} }) {
  const ordenados = [...(aceitos || [])].sort(
    (a, b) => (b.avaliacao?.score ?? 0) - (a.avaliacao?.score ?? 0)
  );
  const testadas = new Set();
  const tentativas = [];
  let n = 0;
  for (const c of ordenados) {
    const urls = (Array.isArray(c.urls) && c.urls.length ? c.urls : [c.url]).filter(Boolean);
    for (const url of urls) {
      if (testadas.has(url)) continue; // duplicada: testada uma única vez
      testadas.add(url);
      n++;
      const v = await validar(url);
      const registro = {
        titulo: c.rotulo, score: c.avaliacao?.score ?? null, urlTentativa: n, url,
        status: v.status ?? null, contentTypeInformado: v.contentType ?? null,
        tipoDetectado: v.tipoDetectado ?? null, bytes: v.bytes ?? null,
        motivoRejeicao: v.ok ? null : v.motivo,
      };
      tentativas.push(registro);
      log(registro);
      if (v.ok) return { escolhido: { ...c, urlValidada: url, validacao: v }, tentativas };
      // 403/404/timeout/inválido → próximo (nunca burlar controle de acesso)
    }
  }
  return { escolhido: null, tentativas };
}

// implementação real com axios (GET real; primeiros bytes p/ assinatura)
export function criarFetchAxios(axios) {
  return async (url, { timeoutMs, maxRedirects, maxBytes = TAMANHO_MAX_BYTES }) => {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
      maxRedirects,
      maxContentLength: maxBytes,   // interrompe download acima do limite
      maxBodyLength: maxBytes,
      validateStatus: () => true,
    });
    const data = r.data ? new Uint8Array(r.data) : new Uint8Array(0);
    return {
      status: r.status,
      contentType: r.headers?.["content-type"] || "",
      bytes: data.length,
      corpo: data.slice(0, 16),
    };
  };
}
