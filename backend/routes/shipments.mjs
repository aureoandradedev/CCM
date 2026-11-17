import { Router } from "express";

import { exigirAdmin } from "../lib/supabase.mjs";
import { updateShipmentStatus, setShipmentTracking, logShipmentOccurrence } from "../lib/shipment-actions.mjs";

const router = Router();

router.post("/status", exigirAdmin, async (req, res) => {
  try {
    const { shipmentId, status } = req.body;
    if (!shipmentId || !status) return res.status(400).json({ ok: false, erro: "shipmentId e status obrigatórios." });
    const actor = { kind: "admin", id: req.usuario.id };
    const result = await updateShipmentStatus(shipmentId, status, actor);
    res.json({ ok: true, shipment: result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

router.post("/tracking", exigirAdmin, async (req, res) => {
  try {
    const { shipmentId, trackingCode, carrier } = req.body;
    if (!shipmentId) return res.status(400).json({ ok: false, erro: "shipmentId obrigatório." });
    const actor = { kind: "admin", id: req.usuario.id };
    const result = await setShipmentTracking(shipmentId, trackingCode, carrier, actor);
    res.json({ ok: true, tracking: result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

router.post("/occurrence", exigirAdmin, async (req, res) => {
  try {
    const { shipmentId, type, description } = req.body;
    if (!shipmentId || !type || !description) return res.status(400).json({ ok: false, erro: "shipmentId, type e description obrigatórios." });
    const actor = { kind: "admin", id: req.usuario.id };
    const result = await logShipmentOccurrence(shipmentId, type, description, actor);
    res.json({ ok: true, occurrence: result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

export default router;
