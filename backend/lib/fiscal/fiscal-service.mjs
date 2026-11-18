/**
 * Fiscal Service — orchestrates DAV lifecycle with idempotency.
 *
 * Flow: isEligible → check existing doc → build payload → send → record
 * Idempotency chain: fiscal_documents → provider_reference → codigoECommerce
 *
 * The adapter handles mock/real distinction based on FISCAL_UNIPLUS_ENABLED.
 * This service always runs the full flow; mocks just return fake data.
 */
import { config } from "../config.mjs";
import { db } from "../supabase.mjs";
import {
  canTransitionFiscal,
  isTerminalFiscalStatus,
  FISCAL_EVENT_TYPES,
} from "./fiscal-types.mjs";
import {
  isEligibleForFiscal,
  buildUniplusDavPayload,
  FiscalValidationError,
} from "./dav-mapper.mjs";
import * as adapter from "./uniplus-dav-adapter.mjs";

function fiscalLog(level, msg, data = {}) {
  const safe = { ...data };
  delete safe.token;
  delete safe.authorization;
  delete safe.raw_response;
  console[level](`[fiscal] ${msg}`, JSON.stringify(safe));
}

async function findExistingDoc(orderId, shipmentId = null) {
  const q = db()
    .from("fiscal_documents")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "uniplus_dav")
    .neq("status", "cancelled");

  if (shipmentId) {
    q.eq("shipment_id", shipmentId);
  } else {
    q.is("shipment_id", null);
  }

  const { data } = await q.maybeSingle();
  return data;
}

async function insertFiscalDoc(doc) {
  const { data, error } = await db()
    .from("fiscal_documents")
    .insert(doc)
    .select()
    .single();

  if (error) {
    if (/unique|duplicate/i.test(error.message || "")) {
      return findExistingDoc(doc.order_id, doc.shipment_id);
    }
    throw error;
  }
  return data;
}

async function updateFiscalDoc(id, updates) {
  const { data, error } = await db()
    .from("fiscal_documents")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

function transitionStatus(doc, newStatus) {
  if (!canTransitionFiscal(doc.status, newStatus)) {
    throw new Error(`Transição fiscal inválida: ${doc.status} → ${newStatus}`);
  }
}

export async function createFiscalDocument(order, items, shipment = null) {
  const eligibility = isEligibleForFiscal(order);
  if (!eligibility.eligible) {
    fiscalLog("info", "Pedido não elegível para fiscal", {
      orderId: order.id,
      reason: eligibility.reason,
    });
    return { skipped: true, reason: eligibility.reason };
  }

  // --- Idempotency step 1: check fiscal_documents ---
  const existing = await findExistingDoc(order.id, shipment?.id ?? null);
  if (existing) {
    if (isTerminalFiscalStatus(existing.status) || existing.status === "created") {
      fiscalLog("info", FISCAL_EVENT_TYPES.FOUND_IDEMPOTENT, {
        orderId: order.id,
        docId: existing.id,
        status: existing.status,
      });
      return { skipped: false, idempotent: true, doc: existing };
    }
    if (existing.status === "sending") {
      fiscalLog("warn", "Documento em envio, não reenviando", { docId: existing.id });
      return { skipped: false, idempotent: true, doc: existing };
    }
  }

  // --- Build payload ---
  let payloadResult;
  try {
    payloadResult = buildUniplusDavPayload(order, items, shipment);
  } catch (err) {
    if (err instanceof FiscalValidationError) {
      fiscalLog("error", "Validação de valores falhou", {
        orderId: order.id,
        errors: err.details?.errors,
      });
      return { skipped: true, reason: "VALIDATION_ERROR", errors: err.details?.errors };
    }
    throw err;
  }

  const { payload, codigoEcommerce, payloadHash } = payloadResult;

  // --- Idempotency step 2: check codigoECommerce ---
  const { data: codigoDoc } = await db()
    .from("fiscal_documents")
    .select("*")
    .eq("codigo_ecommerce", codigoEcommerce)
    .neq("status", "cancelled")
    .maybeSingle();

  if (codigoDoc) {
    fiscalLog("info", FISCAL_EVENT_TYPES.FOUND_IDEMPOTENT, {
      orderId: order.id,
      docId: codigoDoc.id,
      via: "codigo_ecommerce",
    });
    return { skipped: false, idempotent: true, doc: codigoDoc };
  }

  // --- Insert or reuse existing pending/error doc ---
  let doc;
  if (existing && (existing.status === "pending" || existing.status === "error")) {
    doc = await updateFiscalDoc(existing.id, {
      status: "pending",
      payload_hash: payloadHash,
      codigo_ecommerce: codigoEcommerce,
      last_error: null,
    });
  } else {
    doc = await insertFiscalDoc({
      order_id: order.id,
      shipment_id: shipment?.id ?? null,
      provider: "uniplus_dav",
      codigo_ecommerce: codigoEcommerce,
      status: "pending",
      payload_hash: payloadHash,
      attempt_count: 0,
    });
  }

  // --- Send to Uniplus ---
  transitionStatus(doc, "sending");
  doc = await updateFiscalDoc(doc.id, {
    status: "sending",
    attempt_count: (doc.attempt_count || 0) + 1,
    sent_at: new Date().toISOString(),
  });

  try {
    const result = await adapter.createDav(payload);

    doc = await updateFiscalDoc(doc.id, {
      status: "created",
      provider_reference: result.codigo || null,
      raw_response: result.raw,
      last_error: null,
    });

    fiscalLog("info", FISCAL_EVENT_TYPES.CREATED, {
      orderId: order.id,
      docId: doc.id,
      providerRef: doc.provider_reference,
    });

    return { skipped: false, idempotent: false, doc };
  } catch (err) {
    if (err.code === "TIMEOUT") {
      fiscalLog("warn", "Timeout no envio, buscando DAV por código", {
        orderId: order.id,
        codigoEcommerce,
      });
      try {
        const found = await adapter.findDavByCodigoEcommerce(codigoEcommerce);
        if (found.found) {
          doc = await updateFiscalDoc(doc.id, {
            status: "created",
            provider_reference: found.codigo || null,
            raw_response: found.raw,
            last_error: null,
          });
          fiscalLog("info", "DAV encontrado após timeout", {
            docId: doc.id,
            providerRef: doc.provider_reference,
          });
          return { skipped: false, idempotent: false, doc };
        }
      } catch {
        // findDav also failed — fall through to error recording
      }
    }

    doc = await updateFiscalDoc(doc.id, {
      status: "error",
      last_error: String(err.message || "Erro desconhecido").slice(0, 500),
    });

    fiscalLog("error", FISCAL_EVENT_TYPES.SEND_FAILED, {
      orderId: order.id,
      docId: doc.id,
      error: doc.last_error,
      retryable: err.retryable ?? false,
    });

    return { skipped: false, idempotent: false, doc, error: doc.last_error };
  }
}

export async function syncFiscalDocStatus(docId) {
  const { data: doc, error } = await db()
    .from("fiscal_documents")
    .select("*")
    .eq("id", docId)
    .single();

  if (error || !doc) throw new Error("Documento fiscal não encontrado");
  if (isTerminalFiscalStatus(doc.status)) {
    return { skipped: true, reason: "TERMINAL_STATUS", doc };
  }
  if (!doc.provider_reference) {
    return { skipped: true, reason: "NO_PROVIDER_REFERENCE", doc };
  }

  fiscalLog("info", FISCAL_EVENT_TYPES.SYNC_STARTED, {
    docId: doc.id,
    providerRef: doc.provider_reference,
  });

  try {
    const result = await adapter.getDavStatus(doc.provider_reference);
    const raw = result.raw || {};
    const newStatus = mapUniplusStatus(raw.status ?? raw.situacao);

    if (newStatus && newStatus !== doc.status && canTransitionFiscal(doc.status, newStatus)) {
      const updates = { status: newStatus, raw_response: raw };
      if (newStatus === "invoiced") updates.invoiced_at = new Date().toISOString();
      if (newStatus === "cancelled") updates.cancelled_at = new Date().toISOString();

      const updated = await updateFiscalDoc(doc.id, updates);

      fiscalLog("info", FISCAL_EVENT_TYPES.STATUS_CHANGED, {
        docId: doc.id,
        from: doc.status,
        to: newStatus,
      });

      return { skipped: false, doc: updated, changed: true };
    }

    return { skipped: false, doc, changed: false };
  } catch (err) {
    fiscalLog("error", "Falha ao sincronizar status", {
      docId: doc.id,
      error: err.message,
    });
    return { skipped: false, doc, error: err.message };
  }
}

export async function cancelFiscalDocument(docId, reason = "") {
  const { data: doc, error } = await db()
    .from("fiscal_documents")
    .select("*")
    .eq("id", docId)
    .single();

  if (error || !doc) throw new Error("Documento fiscal não encontrado");
  if (doc.status === "cancelled") return { skipped: true, doc };
  if (doc.status === "invoiced") throw new Error("DAV já faturado, cancelamento não permitido");

  if (doc.provider_reference) {
    try {
      await adapter.cancelDav(doc.provider_reference);
    } catch (err) {
      fiscalLog("warn", "Falha ao cancelar DAV no Uniplus", {
        docId: doc.id,
        error: err.message,
      });
    }
  }

  const updated = await updateFiscalDoc(doc.id, {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    last_error: reason ? `Cancelado: ${reason}`.slice(0, 500) : null,
  });

  fiscalLog("info", FISCAL_EVENT_TYPES.CANCELLED, { docId: doc.id, reason });

  return { skipped: false, doc: updated };
}

export async function syncPendingDocuments() {
  const { data: docs } = await db()
    .from("fiscal_documents")
    .select("id")
    .in("status", ["created", "sending"])
    .order("created_at", { ascending: true })
    .limit(50);

  if (!docs?.length) return { synced: 0 };

  let synced = 0;
  for (const d of docs) {
    try {
      const result = await syncFiscalDocStatus(d.id);
      if (result.changed) synced++;
    } catch (err) {
      fiscalLog("error", "Erro ao sincronizar documento", {
        docId: d.id,
        error: err.message,
      });
    }
  }

  fiscalLog("info", FISCAL_EVENT_TYPES.SYNC_COMPLETED, {
    total: docs.length,
    synced,
  });

  return { synced, total: docs.length };
}

export async function getFiscalDocForOrder(orderId, shipmentId = null) {
  return findExistingDoc(orderId, shipmentId);
}

export async function getFiscalDocsForOrder(orderId) {
  const { data } = await db()
    .from("fiscal_documents")
    .select("id, order_id, shipment_id, provider, provider_reference, codigo_ecommerce, status, attempt_count, last_error, created_at, updated_at, sent_at, invoiced_at, cancelled_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  return data || [];
}

function mapUniplusStatus(raw) {
  if (raw == null) return null;
  const s = typeof raw === "number" ? String(raw) : String(raw).toLowerCase();
  if (["faturado", "invoiced", "nfe_emitida", "2", "6"].includes(s)) return "invoiced";
  if (["cancelado", "cancelled", "3"].includes(s)) return "cancelled";
  if (["pendente", "pending", "aberto", "open", "1"].includes(s)) return "created";
  if (["7"].includes(s)) return "created"; // partial invoicing — treat as still open
  if (["erro", "error", "rejeitado", "rejected", "4"].includes(s)) return "error";
  return null;
}
