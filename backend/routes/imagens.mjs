import axios from "axios";
import { Router } from "express";

import { baixarImagem, buscarEGravarImagem, buscarImagemPorNome, hostPermitido, iniciarLote, listarCandidatosPorNome, statusLote, subirImagemProduto } from "../lib/imagens.mjs";
import { limitProxy } from "../lib/rate-limit.mjs";
import { db, exigirAdmin } from "../lib/supabase.mjs";

export const imagens = Router();

/** Melhor foto para um nome (sem gravar nada). */
imagens.get("/buscar", exigirAdmin, async (req, res) => {
  try {
    const nome = String(req.query.nome || "").trim();
    if (nome.length < 3) return res.status(400).json({ ok: false, erro: "nome muito curto" });
    const r = await buscarImagemPorNome(nome, { codigo: "admin" });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

/** Todas as candidatas avaliadas (para o admin escolher). */
imagens.get("/candidatos", exigirAdmin, async (req, res) => {
  try {
    const nome = String(req.query.nome || "").trim();
    if (nome.length < 3) return res.status(400).json({ ok: false, erro: "nome muito curto" });
    res.json({ ok: true, ...(await listarCandidatosPorNome(nome, { codigo: "admin" })) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

/** Proxy de bytes só para URLs devolvidas pela busca (pré-visualização no admin). */
imagens.get("/bytes", exigirAdmin, limitProxy, async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!hostPermitido(url)) return res.status(400).json({ ok: false, erro: "host não permitido" });
    const r = await axios.get(url, { responseType: "arraybuffer", timeout: 20000, maxContentLength: 5 * 1024 * 1024 });
    res.set("Content-Type", r.headers["content-type"] || "image/jpeg");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(r.data));
  } catch {
    res.status(502).json({ ok: false, erro: "não foi possível carregar a imagem" });
  }
});

/** Busca e grava a melhor foto de UM produto (botão no admin). */
imagens.post("/produtos/:id/buscar", exigirAdmin, async (req, res) => {
  try {
    const { data: p, error } = await db().from("products").select("id, sku, name, images, image_manual").eq("id", req.params.id).maybeSingle();
    if (error || !p) return res.status(404).json({ ok: false, erro: "produto não encontrado" });
    res.json(await buscarEGravarImagem(p, { forcar: req.body?.forcar === true }));
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

/** Grava uma URL candidata escolhida à mão (baixa + sobe no Storage). */
imagens.post("/produtos/:id/usar-url", exigirAdmin, async (req, res) => {
  try {
    const url = String(req.body?.url || "");
    if (!hostPermitido(url)) return res.status(400).json({ ok: false, erro: "host não permitido" });
    const { data: p } = await db().from("products").select("id, images").eq("id", req.params.id).maybeSingle();
    if (!p) return res.status(404).json({ ok: false, erro: "produto não encontrado" });
    const { bytes, contentType } = await baixarImagem(url);
    const publica = await subirImagemProduto(p.id, bytes, contentType, url);
    const outras = (p.images || []).filter((u) => !/unsplash\.com/.test(u) && u !== publica);
    await db().from("products").update({ images: [publica, ...outras], image_source: "qrofertas", image_manual: true, image_pending: false, image_pending_reason: null, image_fetched_at: new Date().toISOString() }).eq("id", p.id);
    res.json({ ok: true, url: publica });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

/** Lote em segundo plano: todos os produtos sem foto real. */
imagens.post("/lote", exigirAdmin, async (req, res) => {
  try {
    res.json({ ok: true, lote: await iniciarLote({ apenasSemFoto: req.body?.apenasSemFoto !== false, limite: Number(req.body?.limite) || 100 }) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
imagens.get("/lote", exigirAdmin, (_req, res) => res.json({ ok: true, lote: statusLote() }));
