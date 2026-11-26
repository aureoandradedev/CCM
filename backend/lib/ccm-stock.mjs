/**
 * CCM stock routing + reservation — Bloco 1 V2, Etapa 3.
 *
 * After create_order_atomic, routes items between CCM physical stock and
 * supplier flow, then creates logical reservations via reserve_ccm_stock RPC.
 *
 * When ccm_stock_enabled = false (current state), returns null — the caller
 * treats every item as supplier-bound, preserving the existing flow exactly.
 *
 * FAIL-CLOSED: when flag is ON and any step fails, throws instead of
 * returning null, preventing inconsistent supplier_requests.
 */
import { db } from "./supabase.mjs";
import { ErroPedido } from "./pedido.mjs";

/**
 * @param {string}            orderId  - UUID of the just-created order
 * @param {Array}             itens    - canonical items from montarItens()
 * @param {Map<string,string>} oiMap   - product_id → order_item.id
 * @returns {Promise<{supplierQtyByProduct: Map<string,number>} | null>}
 *          null when flag is OFF; throws when flag is ON and any step fails
 */
export async function routeAndReserveCcmStock(orderId, itens, oiMap) {
  const { data: enabled, error: flagErr } = await db().rpc("is_ccm_stock_enabled");
  if (flagErr) {
    console.error("[ccm-stock] flag check failed:", flagErr.message);
    return null;
  }
  if (!enabled) return null;

  const masterIds = [...new Set(
    itens.filter((i) => i.master_product_id).map((i) => i.master_product_id),
  )];

  // No items with master_product_id → all to supplier
  if (!masterIds.length) {
    return { supplierQtyByProduct: new Map(itens.map((i) => [i.product_id, i.qty])) };
  }

  const { data: availability, error: availErr } = await db()
    .from("ccm_stock_available")
    .select("master_product_id, disponivel")
    .in("master_product_id", masterIds);
  if (availErr) {
    throw new ErroPedido(500, "Falha ao consultar estoque CCM. Tente novamente.");
  }

  const availMap = new Map((availability || []).map((a) => [a.master_product_id, a.disponivel]));
  const remaining = new Map(availMap);
  const ccmReservations = [];
  const supplierQtyByProduct = new Map();

  for (const item of itens) {
    const oiId = oiMap.get(item.product_id);
    if (!oiId || !item.master_product_id) {
      supplierQtyByProduct.set(item.product_id, item.qty);
      continue;
    }

    const disponivel = remaining.get(item.master_product_id) ?? 0;

    if (disponivel <= 0) {
      supplierQtyByProduct.set(item.product_id, item.qty);
    } else if (disponivel >= item.qty) {
      ccmReservations.push({
        order_item_id: oiId,
        master_product_id: item.master_product_id,
        qty: item.qty,
      });
      supplierQtyByProduct.set(item.product_id, 0);
      remaining.set(item.master_product_id, disponivel - item.qty);
    } else {
      ccmReservations.push({
        order_item_id: oiId,
        master_product_id: item.master_product_id,
        qty: disponivel,
      });
      supplierQtyByProduct.set(item.product_id, item.qty - disponivel);
      remaining.set(item.master_product_id, 0);
    }
  }

  if (ccmReservations.length > 0) {
    const { data: resResult, error: resErr } = await db().rpc("reserve_ccm_stock", {
      p_order_id: orderId,
      p_items: ccmReservations,
    });
    if (resErr) {
      throw new ErroPedido(500, "Falha ao reservar estoque CCM. Tente novamente.");
    }
    if (resResult?.skipped) {
      console.log("[ccm-stock] reserve skipped:", resResult.reason);
    }
  }

  return { supplierQtyByProduct };
}
