/**
 * CCM economic protection — Bloco 3 V2.
 *
 * Runs after supplier confirmation resolves to:
 *   1. Calculate savings (expected vs confirmed cost)
 *   2. Generate credit from savings
 *   3. Prorate supplier freight across orders
 *   4. Lock result for payment (project result, check minimum)
 *
 * Guards payment when result protection is pending team decision.
 * Marks credit as used after payment confirmation.
 *
 * When ccm_result_protection_enabled = false, all functions are no-ops.
 */
import { db, registrarEvento } from "./supabase.mjs";
import { ErroPedido } from "./pedido.mjs";

async function isResultProtectionEnabled() {
  const { data, error } = await db().rpc("is_ccm_result_protection_enabled");
  if (error) {
    console.error("[economic-protection] flag check failed:", error.message);
    return false;
  }
  return !!data;
}

/**
 * Run result protection after supplier gate resolves.
 * Calculates savings, generates credit, prorates freight, locks result.
 */
export async function runResultProtection(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  const { data: items, error: itemsErr } = await db()
    .from("order_items")
    .select("id, qty, supplier_cost_centavos, unit_price_centavos, line_centavos")
    .eq("order_id", orderId);

  if (itemsErr || !items?.length) {
    console.error("[economic-protection] failed to load order items:", itemsErr?.message);
    return null;
  }

  const { data: confirmedLines } = await db()
    .from("supplier_request_lines")
    .select("id, supplier_request_id, order_item_id, unit_cost_centavos, cost_confirmed_centavos, quantity_confirmed, status")
    .in("order_item_id", items.map((i) => i.id))
    .in("status", ["confirmado", "confirmado_parcial"]);

  const confirmedMap = new Map();
  for (const cl of confirmedLines || []) {
    const existing = confirmedMap.get(cl.order_item_id);
    if (!existing || cl.cost_confirmed_centavos < (existing.cost_confirmed_centavos ?? cl.unit_cost_centavos)) {
      confirmedMap.set(cl.order_item_id, cl);
    }
  }

  let totalSavings = 0;
  let supplierRequestId = null;
  for (const item of items) {
    const confirmed = confirmedMap.get(item.id);
    if (!confirmed) continue;

    if (!supplierRequestId) supplierRequestId = confirmed.supplier_request_id;

    const expectedCost = item.supplier_cost_centavos ?? 0;
    const actualCost = confirmed.cost_confirmed_centavos ?? confirmed.unit_cost_centavos ?? expectedCost;
    const qty = confirmed.quantity_confirmed ?? item.qty;

    if (actualCost < expectedCost) {
      totalSavings += (expectedCost - actualCost) * qty;
    }
  }

  if (totalSavings > 0 && supplierRequestId) {
    const { error: creditErr } = await db().rpc("generate_credit_from_savings", {
      p_order_id: orderId,
      p_supplier_request_id: supplierRequestId,
      p_savings_centavos: totalSavings,
      p_idempotency_key: `credit_gen:${orderId}:${supplierRequestId}`,
    });
    if (creditErr) {
      console.error("[economic-protection] generate credit failed:", creditErr.message);
    }
  }

  const { data: requests } = await db()
    .from("supplier_requests")
    .select("supplier_id")
    .eq("order_id", orderId)
    .in("status", ["confirmado", "confirmado_parcial"]);

  if (requests?.length) {
    const supplierIds = [...new Set(requests.map((r) => r.supplier_id))];
    for (const supplierId of supplierIds) {
      const { data: pos } = await db()
        .from("supplier_purchase_orders")
        .select("id, freight_centavos")
        .eq("supplier_id", supplierId)
        .gt("freight_centavos", 0);

      for (const po of pos || []) {
        const { error: prorateErr } = await db().rpc("prorate_supplier_freight", {
          p_purchase_order_id: po.id,
        });
        if (prorateErr) {
          console.error("[economic-protection] prorate freight failed:", prorateErr.message);
        }
      }
    }
  }

  const { data: lockResult, error: lockErr } = await db().rpc("lock_result_for_payment", {
    p_order_id: orderId,
    p_idempotency_key: `result_lock:${orderId}`,
  });

  if (lockErr) {
    console.error("[economic-protection] lock result failed:", lockErr.message);
    return { ok: false, error: lockErr.message };
  }

  if (!lockResult?.ok) {
    return { ok: false, error: lockResult?.error };
  }

  await registrarEvento(orderId, "result_protection_evaluated", {
    total_savings_centavos: totalSavings,
    status: lockResult.status,
    projected_result: lockResult.projected_result,
    min_result: lockResult.min_result,
    auto_approved: lockResult.status === "auto_approved",
  });

  return {
    ok: true,
    status: lockResult.status,
    projected_result: lockResult.projected_result,
    needs_team_decision: lockResult.status === "pending",
  };
}

/**
 * Check if result protection gate allows payment.
 * Returns null when flag OFF (no-op). Throws ErroPedido when blocked.
 */
export async function checkResultProtectionGate(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  const { data: order, error } = await db()
    .from("orders")
    .select("result_protection_status")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) return null;

  if (order.result_protection_status === "pending") {
    throw new ErroPedido(
      409,
      "Resultado do pedido em análise pela equipe. Pagamento bloqueado até decisão.",
      { resultProtectionPending: true },
    );
  }

  if (order.result_protection_status === "rejected") {
    throw new ErroPedido(
      409,
      "Resultado do pedido foi rejeitado pela equipe. Entre em contato.",
      { resultProtectionRejected: true },
    );
  }

  return { ok: true, status: order.result_protection_status };
}

/**
 * Mark reserved credit as used after payment confirmation.
 */
export async function useOrderCredit(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  const { data: reserved } = await db()
    .from("credit_ledger")
    .select("id, amount_centavos")
    .eq("order_id", orderId)
    .eq("movement_type", "credit_reserved")
    .limit(1);

  if (!reserved?.length) return { ok: true, skipped: true };

  const entry = reserved[0];
  const { error: useErr } = await db().rpc("use_credit", {
    p_order_id: orderId,
    p_amount_centavos: entry.amount_centavos,
    p_reservation_id: entry.id,
    p_idempotency_key: `credit_use:${orderId}:${entry.id}`,
  });

  if (useErr) {
    console.error("[economic-protection] use credit failed:", useErr.message);
    return { ok: false };
  }

  return { ok: true };
}

/**
 * Release reserved credit when order is cancelled.
 */
export async function releaseOrderCredit(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  const { data: reserved } = await db()
    .from("credit_ledger")
    .select("id, amount_centavos")
    .eq("order_id", orderId)
    .eq("movement_type", "credit_reserved")
    .limit(1);

  if (!reserved?.length) return { ok: true, skipped: true };

  const entry = reserved[0];
  const { error: relErr } = await db().rpc("release_credit", {
    p_order_id: orderId,
    p_amount_centavos: entry.amount_centavos,
    p_reference_id: entry.id,
    p_reason: "Pedido cancelado — crédito reservado devolvido",
    p_idempotency_key: `credit_rel:${orderId}:${entry.id}`,
  });

  if (relErr) {
    console.error("[economic-protection] release credit failed:", relErr.message);
    return { ok: false };
  }

  return { ok: true };
}
