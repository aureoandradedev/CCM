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

/**
 * Check if result protection feature flag is enabled.
 * @returns {Promise<boolean>}
 */
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
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean, skipped?:boolean, status?:string, projected_result?:number}|null>}
 */
export async function runResultProtection(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  // 1. Load order items with supplier cost snapshots + confirmed costs
  const { data: items, error: itemsErr } = await db()
    .from("order_items")
    .select("id, qty, supplier_cost_centavos, unit_price_centavos, line_centavos")
    .eq("order_id", orderId);

  if (itemsErr || !items?.length) {
    console.error("[economic-protection] failed to load order items:", itemsErr?.message);
    return null;
  }

  // 2. Load confirmed costs from supplier_request_lines
  const { data: confirmedLines } = await db()
    .from("supplier_request_lines")
    .select("order_item_id, unit_cost_centavos, cost_confirmed_centavos, quantity_confirmed, status")
    .in("order_item_id", items.map((i) => i.id))
    .in("status", ["confirmado", "confirmado_parcial"]);

  // 3. Calculate savings per item and generate credit
  const confirmedMap = new Map();
  for (const cl of confirmedLines || []) {
    const existing = confirmedMap.get(cl.order_item_id);
    if (!existing || cl.cost_confirmed_centavos < (existing.cost_confirmed_centavos ?? cl.unit_cost_centavos)) {
      confirmedMap.set(cl.order_item_id, cl);
    }
  }

  let totalSavings = 0;
  for (const item of items) {
    const confirmed = confirmedMap.get(item.id);
    if (!confirmed) continue;

    const expectedCost = item.supplier_cost_centavos ?? 0;
    const actualCost = confirmed.cost_confirmed_centavos ?? confirmed.unit_cost_centavos ?? expectedCost;
    const qty = confirmed.quantity_confirmed ?? item.qty;

    if (actualCost < expectedCost) {
      const saving = (expectedCost - actualCost) * qty;
      totalSavings += saving;
    }
  }

  // 4. Generate credit from savings (if any)
  if (totalSavings > 0) {
    const { error: creditErr } = await db().rpc("generate_credit_from_savings", {
      p_order_id: orderId,
      p_amount_centavos: totalSavings,
      p_reason: "Economia na confirmação do fornecedor",
    });
    if (creditErr) {
      console.error("[economic-protection] generate credit failed:", creditErr.message);
    }
  }

  // 5. Prorate supplier freight across orders in same PO
  const { data: poLinks } = await db()
    .from("purchase_requirements")
    .select("purchase_order_id:cycle_date, supplier_id")
    .eq("source_order_id", orderId);

  if (poLinks?.length) {
    const supplierIds = [...new Set(poLinks.map((p) => p.supplier_id))];
    for (const supplierId of supplierIds) {
      // Find POs for this supplier that include this order
      const { data: pos } = await db()
        .from("supplier_purchase_orders")
        .select("id, freight_centavos")
        .eq("supplier_id", supplierId)
        .gt("freight_centavos", 0);

      for (const po of pos || []) {
        if (!po.freight_centavos) continue;

        // Get all orders in this PO
        const { data: poOrderItems } = await db()
          .from("purchase_order_items")
          .select("purchase_order_id, subtotal_centavos")
          .eq("purchase_order_id", po.id);

        if (!poOrderItems?.length) continue;

        // Get order IDs from purchase_requirements for this PO
        const { data: orderIds } = await db()
          .from("purchase_requirements")
          .select("source_order_id, supplier_id")
          .eq("supplier_id", supplierId);

        if (!orderIds?.length) continue;

        // Call the prorate RPC
        const { error: prorateErr } = await db().rpc("prorate_supplier_freight", {
          p_purchase_order_id: po.id,
        });

        if (prorateErr) {
          console.error("[economic-protection] prorate freight failed:", prorateErr.message);
        }
      }
    }
  }

  // 6. Lock result for payment
  const { data: lockResult, error: lockErr } = await db().rpc("lock_result_for_payment", {
    p_order_id: orderId,
  });

  if (lockErr) {
    console.error("[economic-protection] lock result failed:", lockErr.message);
    return { ok: false, error: lockErr.message };
  }

  if (!lockResult?.ok) {
    return { ok: false, error: lockResult?.error };
  }

  // 7. Record event
  await registrarEvento(orderId, "result_protection_evaluated", {
    total_savings_centavos: totalSavings,
    status: lockResult.status,
    projected_result: lockResult.projected_result_centavos,
    min_result: lockResult.min_result_centavos,
    auto_approved: lockResult.status === "auto_approved",
  });

  return {
    ok: true,
    status: lockResult.status,
    projected_result: lockResult.projected_result_centavos,
    needs_team_decision: lockResult.status === "pending",
  };
}

/**
 * Check if result protection gate allows payment.
 * Returns null when flag OFF (no-op). Throws ErroPedido when blocked.
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean, skipped?:boolean}|null>}
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
 * Audit-only: does not change available balance (use has effect=0).
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean}|null>}
 */
export async function useOrderCredit(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  // Check if there's a reserved credit for this order
  const { data: reserved } = await db()
    .from("credit_ledger")
    .select("amount_centavos")
    .eq("order_id", orderId)
    .eq("movement_type", "credit_reserved")
    .limit(1);

  if (!reserved?.length) return { ok: true, skipped: true };

  const amount = reserved[0].amount_centavos;
  const { error: useErr } = await db().rpc("use_credit", {
    p_order_id: orderId,
    p_amount_centavos: amount,
    p_reference_id: orderId,
    p_reference_type: "payment_confirmed",
    p_reason: "Crédito utilizado após pagamento confirmado",
  });

  if (useErr) {
    console.error("[economic-protection] use credit failed:", useErr.message);
    return { ok: false };
  }

  return { ok: true };
}

/**
 * Release reserved credit when order is cancelled.
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean}|null>}
 */
export async function releaseOrderCredit(orderId) {
  if (!(await isResultProtectionEnabled())) return null;

  const { data: reserved } = await db()
    .from("credit_ledger")
    .select("amount_centavos")
    .eq("order_id", orderId)
    .eq("movement_type", "credit_reserved")
    .limit(1);

  if (!reserved?.length) return { ok: true, skipped: true };

  const amount = reserved[0].amount_centavos;
  const { error: relErr } = await db().rpc("release_credit", {
    p_order_id: orderId,
    p_amount_centavos: amount,
    p_reason: "Pedido cancelado — crédito reservado devolvido",
  });

  if (relErr) {
    console.error("[economic-protection] release credit failed:", relErr.message);
    return { ok: false };
  }

  return { ok: true };
}
