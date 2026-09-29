import { Router } from "express";

import { ErroPedido, calcularFreteParaExibicao, consultarPedido, criarPedido } from "../lib/pedido.mjs";
import { cobrarCartao, criarPix, estornar, statusPix, token3ds, tokenSop, webhook } from "../lib/pagamentos.mjs";
import { exigirAdmin, usuarioDoBearer } from "../lib/supabase.mjs";

export const pagamentos = Router();

function responderErro(res, e) {
  if (e instanceof ErroPedido) return res.status(e.status).json({ ok: false, erro: e.message, ...e.extra });
  console.error("[pagamentos]", e?.response?.data || e);
  return res.status(500).json({ ok: false, erro: "Erro interno. Tente de novo em instantes." });
}

/** Cria o pedido (preços/totais recalculados no servidor). Login é opcional. */
pagamentos.post("/criar-pedido", async (req, res) => {
  try {
    const usuario = await usuarioDoBearer(req).catch(() => null);
    res.json(await criarPedido(req.body, usuario));
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.post("/consultar-pedido", async (req, res) => {
  try {
    res.json(await consultarPedido(req.body || {}));
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.post("/calcular-frete", async (req, res) => {
  try {
    res.json(await calcularFreteParaExibicao(req.body));
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.post("/pix", async (req, res) => {
  try {
    res.json(await criarPix(req.body || {}));
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.get("/pix/:orderId/status", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await statusPix(req.params.orderId));
  } catch (e) {
    responderErro(res, e);
  }
});

/** Webhook da Cielo: sempre 200 (ela repete em qualquer não-2xx). */
pagamentos.post("/webhook", async (req, res) => {
  res.status(200).send("ok");
  await webhook(req.body || {});
});

pagamentos.post("/cartao", async (req, res) => {
  try {
    res.json(await cobrarCartao(req.body || {}));
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.get("/cartao/sop-token", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    res.json(await tokenSop());
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.get("/cartao/3ds-token", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    res.json(await token3ds());
  } catch (e) {
    responderErro(res, e);
  }
});

pagamentos.post("/estornar-pagamento", exigirAdmin, async (req, res) => {
  try {
    res.json(await estornar(String(req.body?.orderId || ""), req.usuario));
  } catch (e) {
    responderErro(res, e);
  }
});
