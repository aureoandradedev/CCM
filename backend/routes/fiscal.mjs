import { Router } from "express";

import { exigirAdmin } from "../lib/supabase.mjs";
import {
  createFiscalDocument,
  syncFiscalDocStatus,
  cancelFiscalDocument,
  syncPendingDocuments,
  getFiscalDocsForOrder,
} from "../lib/fiscal/fiscal-service.mjs";
import { adapterInfo } from "../lib/fiscal/uniplus-dav-adapter.mjs";
import { db } from "../lib/supabase.mjs";

const router = Router();

router.get("/status", exigirAdmin, async (_req, res) => {
  try {
    const info = adapterInfo();
    res.json({ ok: true, fiscal: info });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.get("/order/:orderId", exigirAdmin, async (req, res) => {
  try {
    const docs = await getFiscalDocsForOrder(req.params.orderId);
    res.json({ ok: true, docs });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post("/emit", exigirAdmin, async (req, res) => {
  try {
    const { orderId, shipmentId } = req.body;
    if (!orderId) return res.status(400).json({ ok: false, erro: "orderId obrigatório." });

    const { data: order } = await db().from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return res.status(404).json({ ok: false, erro: "Pedido não encontrado." });

    const { data: items } = await db().from("order_items").select("*").eq("order_id", orderId);
    const shipment = shipmentId ? { id: shipmentId } : null;

    const result = await createFiscalDocument(order, items || [], shipment);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

router.post("/sync/:docId", exigirAdmin, async (req, res) => {
  try {
    const result = await syncFiscalDocStatus(req.params.docId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post("/sync-all", exigirAdmin, async (_req, res) => {
  try {
    const result = await syncPendingDocuments();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post("/cancel/:docId", exigirAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await cancelFiscalDocument(req.params.docId, reason || "");
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

export default router;
