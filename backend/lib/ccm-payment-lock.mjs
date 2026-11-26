/**
 * CCM stock lock at payment time — Bloco 1 V2, Etapa 4.
 *
 * Before generating a Pix/card charge, locks CCM-reserved stock via the
 * lock_ccm_stock_for_payment RPC. If the lock reveals shortfall (CCM stock
 * dropped since reservation), creates supplier_requests for the gap and
 * blocks payment until those are confirmed.
 *
 * When ccm_stock_enabled = false, all functions are no-ops.
 */
import { db, registrarEvento } from "./supabase.mjs";
import { ErroPedido } from "./pedido.mjs";

/**
 * Lock CCM stock for an order that is about to be paid.
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean, skipped?:boolean, travado:number, faltou:number, expires_at:string|null, details:Array}|null>}
 *   null when flag is OFF; full lock result otherwise.
 *   Throws ErroPedido(409) when shortfall is detected (needs re-confirmation).
 */
export async function lockCcmStockForPayment(orderId) {
  const { data: enabled, error: flagErr } = await db().rpc("is_ccm_stock_enabled");
  if (flagErr) {
    console.error("[ccm-lock] flag check failed:", flagErr.message);
    return null;
  }
  if (!enabled) return null;

  const { data: lockResult, error: lockErr } = await db().rpc(
    "lock_ccm_stock_for_payment",
    { p_order_id: orderId },
  );

  if (lockErr) {
    throw new ErroPedido(500, "Falha ao travar estoque CCM para pagamento.");
  }

  if (!lockResult?.ok) {
    throw new ErroPedido(500, "Resultado inesperado na trava de estoque CCM.");
  }

  if (lockResult.skipped) {
    return lockResult;
  }

  // Shortfall: CCM stock dropped since reservation
  if (lockResult.faltou > 0) {
    await handleShortfall(orderId, lockResult);
    throw new ErroPedido(
      409,
      "Estoque CCM insuficiente para alguns itens. Itens redirecionados para fornecedor — aguarde confirmação.",
      { ccmShortfall: true, faltou: lockResult.faltou },
    );
  }

  return lockResult;
}

/**
 * Handle shortfall: create supplier_requests for items that couldn't be
 * locked in CCM, then revert order to aguardando-confirmacao.
 */
async function handleShortfall(orderId, lockResult) {
  const details = lockResult.details || [];
  const shortfallItems = details.filter((d) => d.faltou > 0);

  if (shortfallItems.length === 0) return;

  // Load order_items + product info to build supplier_request payload
  const { data: orderItems, error: oiErr } = await db()
    .from("order_items")
    .select("id, product_id, qty, product_name, unit")
    .eq("order_id", orderId);

  if (oiErr || !orderItems?.length) {
    console.error("[ccm-lock] shortfall: failed to load order_items", oiErr?.message);
    return;
  }

  // Load products to get supplier_id and master_product_id
  const productIds = orderItems.map((oi) => oi.product_id);
  const { data: products } = await db()
    .from("products")
    .select("id, supplier_id, master_product_id, supplier_cost_centavos, unit_price_centavos")
    .in("id", productIds);

  const productMap = new Map((products || []).map((p) => [p.id, p]));

  // Build shortfall payload grouped by supplier
  const bySupplier = new Map();
  for (const sf of shortfallItems) {
    const matchingOi = orderItems.filter((oi) => {
      const prod = productMap.get(oi.product_id);
      return prod?.master_product_id === sf.master_product_id;
    });

    for (const oi of matchingOi) {
      const prod = productMap.get(oi.product_id);
      if (!prod?.supplier_id) continue;

      const items = bySupplier.get(prod.supplier_id) ?? [];
      items.push({
        order_item_id: oi.id,
        master_product_id: prod.master_product_id,
        product_name: oi.product_name,
        quantity: sf.faltou,
        unit: oi.unit ?? "un",
        unit_cost_centavos: prod.supplier_cost_centavos ?? prod.unit_price_centavos,
      });
      bySupplier.set(prod.supplier_id, items);
    }
  }

  const suppliersPayload = Array.from(bySupplier.entries())
    .map(([supplier_id, items]) => ({ supplier_id, items }))
    .filter((s) => s.items.length > 0);

  if (suppliersPayload.length > 0) {
    try {
      await db().rpc("create_supplier_requests_for_order", {
        p_order_id: orderId,
        p_suppliers: suppliersPayload,
      });
    } catch (e) {
      console.error("[ccm-lock] shortfall: failed to create supplier_requests", e?.message ?? e);
    }

    // Revert order to aguardando-confirmacao
    await db()
      .from("orders")
      .update({ order_status: "aguardando-confirmacao" })
      .eq("id", orderId)
      .eq("order_status", "aguardando-pagamento");

    await registrarEvento(orderId, "ccm_shortfall", {
      faltou: lockResult.faltou,
      travado: lockResult.travado,
      details: shortfallItems,
      suppliers_created: suppliersPayload.length,
    });
  }
}

/**
 * Compute effective Pix expiration capped by CCM lock TTL.
 * When CCM is disabled, returns the original expiration unchanged.
 * Throws ErroPedido(500) if lock TTL is too short for any safe Pix expiration.
 *
 * @param {number} pixExpiracaoSegundos - configured Pix expiration
 * @returns {Promise<number>} effective Pix expiration in seconds
 */
/**
 * Confirm CCM stock sale after payment is approved.
 * Promotes payment_lock → sold, releases remaining reservations.
 * Also records inventory_movements for sold items (CCM direct sale).
 * No-op when flag is OFF. Idempotent.
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean, skipped?:boolean, soldCount:number, releasedCount:number}|null>}
 */
export async function confirmCcmStockSale(orderId) {
  const { data: enabled, error: flagErr } = await db().rpc("is_ccm_stock_enabled");
  if (flagErr) {
    console.error("[ccm-sale] flag check failed:", flagErr.message);
    return null;
  }
  if (!enabled) return null;

  // 0065: atomic confirm — the RPC now promotes payment_lock → sold AND
  // creates per-reservation inventory_movements in a single SQL transaction.
  // No separate Node calls needed. p_paid_at=null triggers grace-window rescue.
  const { data: result, error: rpcErr } = await db().rpc(
    "confirm_ccm_stock_sale",
    { p_order_id: orderId, p_paid_at: null },
  );

  if (rpcErr) {
    console.error("[ccm-sale] confirm RPC failed:", rpcErr.message);
    return null;
  }

  const soldCount = result?.sold_count ?? 0;

  if (soldCount > 0) {
    const eventData = {
      sold_count: soldCount,
      rescued_count: result?.rescued_count ?? 0,
      rescue_failed: result?.rescue_failed ?? 0,
      released_count: result?.released_count ?? 0,
      movements_count: result?.movements_count ?? 0,
    };

    if (result?.rescue_failed > 0) {
      console.error(
        "[ccm-sale] INCONSISTENCY: %d lock(s) expired and stock unavailable for rescue, order %s",
        result.rescue_failed,
        orderId,
      );
      eventData.inconsistency = true;
    }

    await registrarEvento(orderId, "ccm_stock_sold", eventData);
  }

  return {
    ok: true,
    soldCount,
    rescuedCount: result?.rescued_count ?? 0,
    rescueFailed: result?.rescue_failed ?? 0,
    releasedCount: result?.released_count ?? 0,
  };
}

/**
 * Release CCM stock reservations when an order is cancelled.
 * Releases reservation + payment_lock status rows. Never touches sold.
 * No-op when flag is OFF. Idempotent.
 *
 * @param {string} orderId
 * @returns {Promise<{ok:boolean, skipped?:boolean, releasedCount:number}|null>}
 */
export async function releaseCcmStock(orderId) {
  const { data: enabled, error: flagErr } = await db().rpc("is_ccm_stock_enabled");
  if (flagErr) {
    console.error("[ccm-release] flag check failed:", flagErr.message);
    return null;
  }
  if (!enabled) return null;

  const { data: result, error: rpcErr } = await db().rpc(
    "release_ccm_stock",
    { p_order_id: orderId },
  );

  if (rpcErr) {
    console.error("[ccm-release] release RPC failed:", rpcErr.message);
    return null;
  }

  if (result?.released_count > 0) {
    await registrarEvento(orderId, "ccm_stock_released", {
      released_count: result.released_count,
    });
  }

  return {
    ok: true,
    releasedCount: result?.released_count ?? 0,
  };
}

export async function getEffectivePixExpiration(pixExpiracaoSegundos) {
  const { data: enabled } = await db().rpc("is_ccm_stock_enabled");
  if (!enabled) return pixExpiracaoSegundos;

  const { data: ttlMinutes } = await db().rpc("get_payment_lock_ttl_minutes");
  const lockTtlSeconds = (ttlMinutes ?? 15) * 60;
  const margin = 120;
  const minSafePix = 60;
  const available = lockTtlSeconds - margin;

  if (available < minSafePix) {
    throw new ErroPedido(
      500,
      `Configuração inválida: lock TTL (${lockTtlSeconds}s) menos margem (${margin}s) = ${available}s, abaixo do mínimo seguro (${minSafePix}s). Ajuste payment_lock_ttl_minutes.`,
    );
  }

  if (pixExpiracaoSegundos <= available) return pixExpiracaoSegundos;

  console.log(
    `[ccm-lock] Pix TTL capped: ${pixExpiracaoSegundos}s → ${available}s (lock TTL: ${lockTtlSeconds}s)`,
  );
  return available;
}
