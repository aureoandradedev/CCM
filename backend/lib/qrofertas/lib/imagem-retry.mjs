/* =========================================================================
   imagem-retry.mjs — cooldown de tentativas para produtos SEM imagem confiável
   ==========================================================================
   Regras:
   - falhou → imagePending=true, imageLastAttemptAt=agora,
     imageRetryAt=agora+6h, imagePendingReason=<motivo resumido>;
   - dentro do cooldown: NÃO consulta o QRofertas e NÃO regrava o mesmo estado;
   - imagem válida encontrada → preenche img/imageSource e LIMPA os campos de
     pendência (via sentinela de delete injetada — FieldValue.delete());
   - imageManual=true é intocável;
   - force=true (CLI --force) ignora o cooldown.
========================================================================= */

export const IMAGE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 horas (motivo DEFINITIVO)

/* ---- Cooldown POR MOTIVO (QRofertas lento/instável ≠ produto sem imagem) ----
   - qrofertas-indisponivel/qrofertas-timeout (login, timeout, rede): 5 min;
   - resposta parcial / loader pendente / só URLs inválidas: 10 min;
   - falhas repetidas: dobra progressivamente até no MÁXIMO 30 min;
   - somente motivo DEFINITIVO (candidatos completos e nenhum serve) usa 6 h. */
export const COOLDOWN_TEMPORARIO_MS = Object.freeze({
  "qrofertas-indisponivel": 5 * 60 * 1000,
  "qrofertas-timeout": 5 * 60 * 1000,
  "qrofertas-parcial": 10 * 60 * 1000,
  "urls-invalidas": 10 * 60 * 1000,
});
export const COOLDOWN_MAX_TEMPORARIO_MS = 30 * 60 * 1000;

export function ehMotivoTemporario(motivo) {
  return Object.prototype.hasOwnProperty.call(COOLDOWN_TEMPORARIO_MS, String(motivo || ""));
}

// classifica o erro bruto em motivo padronizado
export function classificarMotivo(erroOuMotivo) {
  const s = String(erroOuMotivo || "").toLowerCase();
  if (/timeout|etimedout|econnaborted/.test(s)) return "qrofertas-timeout";
  if (/login|credencia|econnreset|enotfound|network|socket|5\d\d|http-5/.test(s)) return "qrofertas-indisponivel";
  if (/parcial|pendente|loader/.test(s)) return "qrofertas-parcial";
  if (/http-4|assinatura|corpo-vazio|content-type|url-invalida|tamanho/.test(s)) return "urls-invalidas";
  return "sem-candidato-confiavel";
}

// duração do cooldown considerando falhas consecutivas (progressão ×2, cap 30min)
export function cooldownPorMotivo(motivo, falhasConsecutivas = 0) {
  if (!ehMotivoTemporario(motivo)) return IMAGE_RETRY_COOLDOWN_MS; // definitivo: 6h
  const base = COOLDOWN_TEMPORARIO_MS[motivo];
  const fator = Math.pow(2, Math.max(0, Math.min(10, falhasConsecutivas)));
  return Math.min(base * fator, COOLDOWN_MAX_TEMPORARIO_MS);
}

// falha temporária NUNCA entra em cache/quarentena longa do serviço
export function deveCachearFalha(motivo) {
  return !ehMotivoTemporario(motivo);
}

// Decide se a busca de imagem deve rodar para este doc.
export function deveTentarImagem(atual, { agora = Date.now(), force = false } = {}) {
  if (atual?.imageManual === true) return { tentar: false, motivo: "image-manual-intocavel" };
  // Revalidação AMBÍGUA: imagem foi limpa sistematicamente porque a URL era
  // compartilhada entre produtos com tokens incompatíveis e o QROfertas não
  // conseguiu distingui-los. Bloqueia re-fetch automático para evitar loop
  // (QROfertas devolveria a mesma URL → detecta suspeita → limpa → repete).
  // Só imageManual=true (upload manual no admin) destranca.
  if (!force && atual?.imagePendingReason === "revalidacao-ambigua") {
    return { tentar: false, motivo: "revalidacao-ambigua" };
  }
  if (atual?.img) return { tentar: false, motivo: "ja-tem-imagem" };
  if (!force && atual?.imagePending === true && Number(atual.imageRetryAt) > agora) {
    return { tentar: false, motivo: "cooldown", retryAt: Number(atual.imageRetryAt) };
  }
  return { tentar: true };
}

// Campos a gravar quando a tentativa FALHOU. Se o doc já está pendente com
// retryAt futuro (mesmo estado), devolve {} — nenhuma escrita repetitiva.
export function camposImagemPendente({ atual, motivo, agora = Date.now() } = {}) {
  if (atual?.imageManual === true) return {};
  if (atual?.imagePending === true && Number(atual.imageRetryAt) > agora) return {};
  const mot = classificarMotivo(motivo);
  // falhas consecutivas do MESMO tipo temporário → progressão do cooldown
  const falhas =
    ehMotivoTemporario(mot) && atual?.imagePendingReason === mot
      ? Number(atual?.imageFailCount || 0) + 1
      : 0;
  return {
    imagePending: true,
    imageLastAttemptAt: agora,
    imageRetryAt: agora + cooldownPorMotivo(mot, falhas),
    imagePendingReason: mot, // padronizado: qrofertas-indisponivel | qrofertas-timeout | qrofertas-parcial | urls-invalidas | sem-candidato-confiavel
    imageFailCount: falhas,
    imageSource: null,
  };
}

// Campos a gravar quando uma imagem VÁLIDA foi encontrada.
// deleteSentinel = admin.firestore.FieldValue.delete() (injetado pelo chamador)
// — limpa imagePending/imageLastAttemptAt/imageRetryAt/imagePendingReason.
export function camposImagemEncontrada({ url, fonte = "qrofertas", agora = Date.now(), deleteSentinel } = {}) {
  const del = deleteSentinel !== undefined ? deleteSentinel : null;
  return {
    img: url,
    imageSource: fonte,
    imageFetchedAt: agora,
    imagePending: del,
    imageLastAttemptAt: del,
    imageRetryAt: del,
    imagePendingReason: del,
    imageFailCount: del,
  };
}
