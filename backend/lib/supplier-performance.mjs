/**
 * Supplier performance event recorder.
 * Idempotent via (supplier_id, event_type, reference_type, reference_id) unique index.
 * Never throws — logs warning on failure.
 */
import { db } from "./supabase.mjs";

export async function recordPerformance(supplierId, eventType, referenceType, referenceId, metricValue = null, data = {}) {
  try {
    const { error } = await db()
      .from("supplier_performance_events")
      .upsert(
        {
          supplier_id: supplierId,
          event_type: eventType,
          reference_type: referenceType || null,
          reference_id: referenceId || null,
          metric_value: metricValue,
          data,
        },
        {
          onConflict: "supplier_id,event_type,reference_type,reference_id",
          ignoreDuplicates: true,
        },
      );

    if (error) {
      if (error.code === "23505") return;
      console.warn(`[performance] Failed to record ${eventType} for ${supplierId}:`, error.message);
    }
  } catch (e) {
    console.warn(`[performance] Exception recording ${eventType}:`, e.message);
  }
}

export async function recordPOSent(supplierId, purchaseOrderId) {
  await recordPerformance(supplierId, "po_sent", "purchase_order", purchaseOrderId);
}

export async function recordPOConfirmed(supplierId, purchaseOrderId, confirmationHours = null) {
  await recordPerformance(supplierId, "po_confirmed", "purchase_order", purchaseOrderId, confirmationHours);
}

export async function recordPOConfirmationTimeout(supplierId, purchaseOrderId, hoursElapsed = null) {
  await recordPerformance(supplierId, "po_confirmation_timeout", "purchase_order", purchaseOrderId, hoursElapsed);
}

export async function recordDeliveryOnTime(supplierId, purchaseOrderId) {
  await recordPerformance(supplierId, "delivery_on_time", "purchase_order", purchaseOrderId);
}

export async function recordDeliveryLate(supplierId, purchaseOrderId, hoursLate = null) {
  await recordPerformance(supplierId, "delivery_late", "purchase_order", purchaseOrderId, hoursLate);
}

export async function recordReceivingResult(supplierId, receivingSessionId, summary) {
  const { totalExpected, totalReceived, totalAccepted, totalDamaged } = summary;

  if (totalReceived >= totalExpected && totalDamaged === 0) {
    await recordPerformance(supplierId, "receiving_full_match", "receiving_session", receivingSessionId);
    return;
  }

  if (totalReceived < totalExpected) {
    await recordPerformance(
      supplierId, "receiving_shortage", "receiving_session", receivingSessionId,
      totalExpected - totalReceived, { totalExpected, totalReceived },
    );
  }

  if (totalReceived > totalExpected) {
    await recordPerformance(
      supplierId, "receiving_excess", "receiving_session", receivingSessionId,
      totalReceived - totalExpected, { totalExpected, totalReceived },
    );
  }

  if (totalDamaged > 0) {
    await recordPerformance(
      supplierId, "receiving_damage", "receiving_session", receivingSessionId,
      totalDamaged, { totalAccepted, totalDamaged },
    );
  }
}

export async function recordReceivingSwap(supplierId, receivingSessionId, details = {}) {
  await recordPerformance(supplierId, "receiving_swap", "receiving_session", receivingSessionId, null, details);
}

export async function recordCutFromCycle(supplierId, purchaseOrderId, reason = null) {
  await recordPerformance(supplierId, "cut_from_cycle", "purchase_order", purchaseOrderId, null, { reason });
}
