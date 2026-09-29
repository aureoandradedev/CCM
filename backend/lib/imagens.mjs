/**
 * Fotos de produto: busca no QRofertas (mesmo motor do gerador de encartes),
 * baixa os bytes validados e sobe no Storage do Supabase (bucket `produtos`).
 */
import axios from "axios";

import { config } from "./config.mjs";
import { db } from "./supabase.mjs";

const HOSTS_PERMITIDOS = /(^|\.)(qrofertas\.com|amazonaws\.com|cloudfront\.net)$/i;

let servico = null;
async function qrofertas() {
  if (!config.qrofertasConfigurado) throw new Error("QROFERTAS_EMAIL / QROFERTAS_PASSWORD não configurados no backend/.env.");
  if (!servico) servico = await import("./qrofertas/qrofertasService.js");
  return servico;
}

export async function buscarImagemPorNome(nome, contexto = {}) {
  const s = await qrofertas();
  return s.buscarImagemPorNome(nome, contexto);
}
export async function listarCandidatosPorNome(nome, contexto = {}) {
  const s = await qrofertas();
  return s.listarCandidatosPorNome(nome, contexto);
}

export function hostPermitido(url) {
  try {
    return HOSTS_PERMITIDOS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function extensaoDe(contentType, url) {
  if (/webp/i.test(contentType)) return "webp";
  if (/png/i.test(contentType)) return "png";
  if (/gif/i.test(contentType)) return "gif";
  if (/jpe?g/i.test(contentType)) return "jpg";
  const m = String(url).match(/\.(webp|png|gif|jpe?g)(\?|$)/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/** Baixa a imagem (só hosts da busca) e devolve { bytes, contentType }. */
export async function baixarImagem(url) {
  if (!hostPermitido(url)) throw new Error("URL fora dos hosts permitidos.");
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 20000, maxContentLength: 5 * 1024 * 1024 });
  const bytes = Buffer.from(r.data);
  const magic = bytes.subarray(0, 12).toString("hex");
  let contentType = null;
  if (magic.startsWith("ffd8ff")) contentType = "image/jpeg";
  else if (magic.startsWith("89504e47")) contentType = "image/png";
  else if (magic.startsWith("47494638")) contentType = "image/gif";
  else if (magic.startsWith("52494646") && bytes.subarray(8, 12).toString() === "WEBP") contentType = "image/webp";
  if (!contentType) throw new Error("Conteúdo baixado não é imagem.");
  return { bytes, contentType };
}

/** Sobe no Storage e devolve a URL pública. */
export async function subirImagemProduto(productId, bytes, contentType, urlOrigem = "") {
  const ext = extensaoDe(contentType, urlOrigem);
  const path = `${productId}/${Date.now()}.${ext}`;
  const { error } = await db().storage.from("produtos").upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error("Upload no Storage falhou: " + error.message);
  const { data } = db().storage.from("produtos").getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Fluxo completo para UM produto: busca → baixa → sobe → grava em products.images[0].
 * Nunca sobrescreve foto manual (image_manual = true) a não ser com forcar=true.
 */
export async function buscarEGravarImagem(product, { forcar = false } = {}) {
  if (product.image_manual && !forcar) return { ok: false, motivo: "imagem-manual" };
  const { url, motivo } = await buscarImagemPorNome(product.name, { codigo: product.sku || product.id });
  if (!url) {
    await db()
      .from("products")
      .update({ image_pending: true, image_pending_reason: motivo, image_retry_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString() })
      .eq("id", product.id);
    return { ok: false, motivo };
  }
  const { bytes, contentType } = await baixarImagem(url);
  const publica = await subirImagemProduto(product.id, bytes, contentType, url);
  const outras = (product.images || []).filter((u) => !/unsplash\.com/.test(u) && u !== publica);
  await db()
    .from("products")
    .update({ images: [publica, ...outras], image_source: "qrofertas", image_manual: false, image_pending: false, image_pending_reason: null, image_fetched_at: new Date().toISOString(), image_retry_at: null })
    .eq("id", product.id);
  return { ok: true, url: publica, origem: url };
}

/* ---------- lote em segundo plano (admin: "Buscar fotos pendentes") ---------- */
let lote = { rodando: false, total: 0, feitos: 0, ok: 0, falhas: 0, atual: null, iniciadoEm: null, fim: null, erro: null };

export function statusLote() {
  return { ...lote };
}

export async function iniciarLote({ apenasSemFoto = true, limite = 100 } = {}) {
  if (lote.rodando) return statusLote();
  let q = db().from("products").select("id, sku, name, images, image_manual").eq("active", true).order("sort").limit(limite);
  if (apenasSemFoto) q = q.or("images.eq.{},image_pending.eq.true,images.cs.{\"https://images.unsplash.com\"}");
  const { data: produtos, error } = await q;
  if (error) throw new Error(error.message);
  // filtro final em JS: sem foto real (vazio ou placeholder)
  const alvo = (produtos || []).filter((p) => !p.image_manual && (!p.images?.length || /unsplash\.com/.test(p.images[0] || "")));
  lote = { rodando: true, total: alvo.length, feitos: 0, ok: 0, falhas: 0, atual: null, iniciadoEm: new Date().toISOString(), fim: null, erro: null };
  (async () => {
    for (const p of alvo) {
      lote.atual = p.name;
      try {
        const r = await buscarEGravarImagem(p);
        if (r.ok) lote.ok++;
        else lote.falhas++;
      } catch (e) {
        lote.falhas++;
        console.warn("[imagens] falha", p.id, e.message);
      }
      lote.feitos++;
    }
    lote.rodando = false;
    lote.atual = null;
    lote.fim = new Date().toISOString();
  })().catch((e) => {
    lote.rodando = false;
    lote.erro = e.message;
  });
  return statusLote();
}
