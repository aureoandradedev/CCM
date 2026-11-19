import { Router } from "express";
import { exigirAdmin, exigirRole } from "../lib/supabase.mjs";
import {
  startReceiving,
  recordItem,
  completeReceiving,
  getSessionAllocationPlan,
  confirmAllocation,
  ReceivingError,
} from "../lib/receiving.mjs";

const router = Router();

function handleErr(res, e) {
  const status = e instanceof ReceivingError ? e.status : 500;
  res.status(status).json({ ok: false, erro: e.message });
}

router.post("/start", exigirRole("recebedor"), async (req, res) => {
  try {
    const { purchaseOrderId } = req.body;
    if (!purchaseOrderId) return res.status(400).json({ ok: false, erro: "purchaseOrderId obrigatório." });
    const result = await startReceiving(purchaseOrderId, req.usuario.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post("/item", exigirRole("recebedor"), async (req, res) => {
  try {
    const { sessionId, ...data } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, erro: "sessionId obrigatório." });
    const item = await recordItem(sessionId, data);
    res.json({ ok: true, item });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post("/complete", exigirRole("recebedor"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, erro: "sessionId obrigatório." });
    const result = await completeReceiving(sessionId);
    res.json({ ok: true, ...result });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post("/allocation-plan", exigirAdmin, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, erro: "sessionId obrigatório." });
    const result = await getSessionAllocationPlan(sessionId);
    res.json({ ok: true, ...result });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post("/confirm-allocation", exigirAdmin, async (req, res) => {
  try {
    const { sessionId, allocations } = req.body;
    if (!sessionId || !allocations) {
      return res.status(400).json({ ok: false, erro: "sessionId e allocations obrigatórios." });
    }
    const result = await confirmAllocation(sessionId, allocations, req.usuario.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    handleErr(res, e);
  }
});

export default router;
