import { Router } from "express";
import { createHash } from "node:crypto";

import { ErroPedido } from "../lib/pedido.mjs";
import { db, exigirLogin } from "../lib/supabase.mjs";
import { runResultProtection } from "../lib/ccm-economic-protection.mjs";

const outbox = Router();

function responderErro(res, e) {
  if (e instanceof ErroPedido) return res.status(e.status).json({ ok: false, erro: e.message, ...e.extra });
  console.error("[outbox]", e?.message || e);
  return res.status(500).json({ ok: false, erro: "Erro interno." });
}

/** GET /api/outbox?status=pending&limit=50 — polling pelo multigiro-wpp */
outbox.get("/", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { data, error } = await db()
      .from("order_notification_outbox")
      .select("id, order_id, event_type, recipient_type, recipient_id, payload, status, created_at")
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new ErroPedido(500, error.message);
    res.json({ ok: true, items: data || [] });
  } catch (e) {
    responderErro(res, e);
  }
});

/** PATCH /api/outbox — mark items as sent/failed */
outbox.patch("/", async (req, res) => {
  try {
    const updates = req.body?.updates;
    if (!Array.isArray(updates) || !updates.length) throw new ErroPedido(400, "updates[] obrigatório.");
    const results = [];
    for (const u of updates) {
      if (!u.id || !["sent", "failed", "skipped"].includes(u.status)) continue;
      const patch = { status: u.status };
      if (u.status === "sent") patch.sent_at = new Date().toISOString();
      const { error } = await db().from("order_notification_outbox").update(patch).eq("id", u.id);
      results.push({ id: u.id, ok: !error, error: error?.message });
    }
    res.json({ ok: true, results });
  } catch (e) {
    responderErro(res, e);
  }
});

/** POST /api/outbox/validate-token — validate guest access token */
outbox.post("/validate-token", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token || token.length !== 64) throw new ErroPedido(400, "Token inválido.");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data, error } = await db().rpc("validate_order_token", { p_token_hash: tokenHash });
    if (error) throw new ErroPedido(500, error.message);
    if (!data?.ok) throw new ErroPedido(401, data?.error || "Token inválido ou expirado.");
    res.json(data);
  } catch (e) {
    responderErro(res, e);
  }
});

/** POST /api/outbox/supplier-gate — check if all supplier requests resolved */
outbox.post("/supplier-gate", exigirLogin, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) throw new ErroPedido(400, "orderId obrigatório.");
    const { data, error } = await db().rpc("check_order_request_gate", { p_order_id: orderId });
    if (error) throw new ErroPedido(500, error.message);

    // Bloco 3: after supplier gate resolves, run economic protection
    if (data?.ok && !data?.blocked) {
      try {
        const econ = await runResultProtection(orderId);
        if (econ) data.result_protection = econ;
      } catch (e) {
        console.error("[economic-protection] run failed:", orderId, e?.message ?? e);
      }
    }

    res.json(data);
  } catch (e) {
    responderErro(res, e);
  }
});

export default outbox;
