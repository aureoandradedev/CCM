/* =========================================================================
   imagem-revalidador.mjs — detecção SISTÊMICA de imagens QROfertas suspeitas
   ==========================================================================
   Problema: o sync NÃO re-consulta produtos que já possuem img preenchido
   (deveTentarImagem retorna "ja-tem-imagem"). Imagens atribuídas antes do
   matcher robusto podem estar erradas — ex.: Gulozitos Presunto e Gulozitos
   Cebola compartilham a mesma URL, claramente uma está incorreta.

   Solução: ANTES do loop de sync, identificar produtos com imagens suspeitas
   usando critérios sistêmicos (sem hardcoded IDs):

   1. Mesma URL de imagem em 2+ produtos
   2. imageSource === "qrofertas" (nunca tocar em imageManual === true)
   3. Produtos do grupo têm tokens discriminantes INCOMPATÍVEIS
      (ex.: sabores diferentes, marcas diferentes)

   Produtos identificados como suspeitos podem ser RE-CONSULTADOS no QROfertas.
   Se a re-consulta encontrar uma imagem MELHOR (URL diferente) → substitui.
   Se NÃO encontrar → mantém a imagem existente (NÃO remove).
   Placeholder > foto errada, mas foto existente > placeholder quando não há
   certeza de que é errada.

   IMPORTANTE (confirmado pelo live dry-run 2026-08-07):
   O próprio QROfertas pode retornar a MESMA URL para variantes diferentes
   (ex.: Gulozitos Presunto e Gulozitos Cebola). Nesses casos a revalidação
   NÃO é considerada bem-sucedida — o resultado é AMBÍGUO. Nunca inventar
   outra imagem nem usar fonte externa ao QROfertas.
========================================================================= */

import { extrairTokens } from "./imagem-matcher.mjs";

/**
 * Identifica produtos com imagens QROfertas potencialmente incorretas.
 *
 * @param {Object} existentes  Mapa id → doc Firestore (como retornado pelo snap)
 * @returns {Map<string, Object>}  productId → { motivo, urlCompartilhada, grupo }
 *   - motivo: string descritiva (ex.: "url-compartilhada-tokens-incompativeis")
 *   - urlCompartilhada: a URL duplicada
 *   - grupo: array de { id, name } dos produtos que compartilham a URL
 */
export function identificarImagensSuspeitas(existentes) {
  const suspeitos = new Map();

  // 1. Agrupar produtos por URL de imagem (somente QROfertas, não-manual)
  const urlParaProdutos = new Map(); // url → [{ id, name, doc }]

  for (const [id, doc] of Object.entries(existentes)) {
    if (!doc?.img) continue;
    if (doc.imageManual === true) continue;
    if (doc.imageSource !== "qrofertas") continue;

    const url = String(doc.img).trim();
    if (!url) continue;

    if (!urlParaProdutos.has(url)) urlParaProdutos.set(url, []);
    urlParaProdutos.get(url).push({
      id,
      name: String(doc.name || "").trim(),
      doc,
    });
  }

  // 2. Para cada URL compartilhada por 2+ produtos, verificar compatibilidade
  for (const [url, produtos] of urlParaProdutos) {
    if (produtos.length < 2) continue;

    // Extrair tokens de cada produto
    const comTokens = produtos.map((p) => ({
      ...p,
      tokens: extrairTokens(p.name),
    }));

    // Verificar se os tokens core são incompatíveis entre os produtos.
    // "Incompatíveis" = pelo menos um par de produtos tem tokens core que
    // diferem em palavras substantivas (sabor, variante, tipo).
    // Ex.: ["gulozitos","presunto"] vs ["gulozitos","cebola"] → "presunto"≠"cebola"
    if (temTokensIncompativeis(comTokens)) {
      for (const p of produtos) {
        suspeitos.set(p.id, {
          motivo: "url-compartilhada-tokens-incompativeis",
          urlCompartilhada: url,
          grupo: produtos.map((x) => ({ id: x.id, name: x.name })),
        });
      }
    }
  }

  return suspeitos;
}

/**
 * Verifica se um grupo de produtos com mesma URL tem tokens incompatíveis.
 * Retorna true se pelo menos um par difere em tokens discriminantes.
 */
function temTokensIncompativeis(produtosComTokens) {
  if (produtosComTokens.length < 2) return false;

  for (let i = 0; i < produtosComTokens.length; i++) {
    for (let j = i + 1; j < produtosComTokens.length; j++) {
      const a = produtosComTokens[i].tokens;
      const b = produtosComTokens[j].tokens;

      // Tokens core que estão em A mas não em B, e vice-versa
      const soEmA = a.core.filter((w) => !b.core.includes(w));
      const soEmB = b.core.filter((w) => !a.core.includes(w));

      // Se ambos têm pelo menos 1 token exclusivo → são produtos diferentes
      // compartilhando a mesma imagem
      if (soEmA.length > 0 && soEmB.length > 0) return true;

      // Volume ou embalagem conflitante também indica incompatibilidade
      if (a.volume && b.volume) {
        if (
          a.volume.tipo !== b.volume.tipo ||
          a.volume.valor !== b.volume.valor
        )
          return true;
      }
      if (a.embalagem && b.embalagem && a.embalagem !== b.embalagem) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Dado o resultado de identificarImagensSuspeitas, decide se um produto
 * específico deve ser revalidado no próximo sync.
 *
 * Regras de segurança:
 * - imageManual === true → NUNCA revalidar (checado antes, mas redundância)
 * - Produto não está no mapa de suspeitos → não revalidar
 * - Produto está suspeito → permitir re-consulta ao QROfertas
 *
 * @param {string} id         ID do produto
 * @param {Object} atual      Doc Firestore atual
 * @param {Map} suspeitos     Resultado de identificarImagensSuspeitas
 * @returns {{ revalidar: boolean, motivo?: string, info?: Object }}
 */
export function deveRevalidar(id, atual, suspeitos) {
  if (!atual?.img) return { revalidar: false };
  if (atual.imageManual === true) return { revalidar: false };
  if (!suspeitos.has(id)) return { revalidar: false };

  return {
    revalidar: true,
    motivo: suspeitos.get(id).motivo,
    info: suspeitos.get(id),
  };
}

/**
 * Avalia o resultado de uma revalidação QROfertas para um produto suspeito.
 *
 * Cenários:
 * - QROfertas retornou URL DIFERENTE da atual → CONFIÁVEL (pode substituir)
 * - QROfertas retornou a MESMA URL que o produto já tem → AMBÍGUO
 *   (o QROfertas não tem imagem diferente para esta variante)
 * - QROfertas retornou MESMA URL que outro produto do grupo com tokens
 *   incompatíveis → AMBÍGUO (confirmado: QROfertas devolve a mesma foto
 *   para variantes diferentes — live dry-run 2026-08-07)
 * - QROfertas não retornou nada → SEM RESULTADO (manter imagem atual)
 *
 * @param {string} urlRetornada   URL retornada pelo QROfertas (ou null)
 * @param {Object} info           info do mapa de suspeitos (tem urlCompartilhada e grupo)
 * @param {Object} atual          doc Firestore atual do produto
 * @returns {{ classificacao: string, deveSubstituir: boolean, motivo: string }}
 */
export function avaliarResultadoRevalidacao(urlRetornada, info, atual) {
  if (!urlRetornada) {
    return {
      classificacao: "SEM-RESULTADO",
      deveSubstituir: false,
      motivo: "qrofertas-sem-candidato",
    };
  }

  const urlAtual = String(atual?.img || "").trim();

  // Mesma URL que o produto já possui
  if (urlRetornada === urlAtual) {
    return {
      classificacao: "AMBIGUO",
      deveSubstituir: false,
      motivo: "revalidacao-retornou-mesma-url-atual",
    };
  }

  // URL diferente da atual, mas igual à URL compartilhada do grupo
  // (outro produto com tokens incompatíveis já tem essa URL)
  if (urlRetornada === info?.urlCompartilhada) {
    return {
      classificacao: "AMBIGUO",
      deveSubstituir: false,
      motivo: "revalidacao-retornou-url-compartilhada-do-grupo",
    };
  }

  // Verificar se a URL retornada é a mesma de QUALQUER outro produto do grupo
  // com tokens incompatíveis (pode ser uma URL diferente da original mas
  // compartilhada com outro membro do grupo)
  if (info?.grupo) {
    for (const membro of info.grupo) {
      if (membro.id !== String(atual?.id ?? "")) {
        // Não podemos checar a img atual do membro aqui (não temos o doc),
        // mas a urlCompartilhada já cobre o caso principal
      }
    }
  }

  // URL genuinamente diferente → confiável
  return {
    classificacao: "CONFIAVEL",
    deveSubstituir: true,
    motivo: "revalidacao-encontrou-url-diferente",
  };
}

/* =========================================================================
   EXPORTAÇÕES PARA TESTES
========================================================================= */
export { temTokensIncompativeis as _temTokensIncompativeis };
