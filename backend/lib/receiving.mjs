/**
 * Recebimento no CD — operações de banco.
 *
 * Fluxo:
 *   1. startReceiving(poId, inspectorId) → cria sessão
 *   2. recordItem(sessionId, data) → registra conferência de 1 item
 *   3. completeReceiving(sessionId) → finaliza, retorna plano de alocação (NÃO persiste)
 *   4. confirmAllocation(sessionId, plan) → persiste alocação, estoque, exceções
 */
import { db } from "./supabase.mjs";
import { recordReceivingResult, recordReceivingSwap } from "./supplier-performance.mjs";

export class ReceivingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function startReceiving(purchaseOrderId, inspectorId) {
  const { data: po, error: poErr } = await db()
    .from("supplier_purchase_orders")
    .select("id, status, supplier_id")
    .eq("id", purchaseOrderId)
    .maybeSingle();

  if (poErr || !po) throw new ReceivingError(404, "Pedido de compra não encontrado.");
  if (!["sent", "ready"].includes(po.status)) {
    throw new ReceivingError(400, `PO status '${po.status}' não permite recebimento.`);
  }

  const { data: existing } = await db()
    .from("receiving_sessions")
    .select("id")
    .eq("purchase_order_id", purchaseOrderId)
    .eq("status", "in_progress")
    .maybeSingle();

  if (existing) throw new ReceivingError(409, "Já existe sessão de recebimento em andamento para este PO.");

  const { data: items } = await db()
    .from("purchase_order_items")
    .select("id, master_product_id, product_name, quantity_units")
    .eq("purchase_order_id", purchaseOrderId);

  const { data: session, error: sessErr } = await db()
    .from("receiving_sessions")
    .insert({
      purchase_order_id: purchaseOrderId,
      inspector_id: inspectorId,
    })
    .select("id, status, started_at")
    .single();

  if (sessErr) throw new ReceivingError(500, sessErr.message);

  return { session, expectedItems: items, supplierId: po.supplier_id };
}

const MAX_PHOTOS_PER_ITEM = 10;

export async function recordItem(sessionId, data) {
  const { data: session } = await db()
    .from("receiving_sessions")
    .select("id, status, purchase_order_id")
    .eq("id", sessionId)
    .eq("status", "in_progress")
    .maybeSingle();

  if (!session) throw new ReceivingError(404, "Sessão não encontrada ou já finalizada.");

  // Derive expected_qty server-side from purchase_order_items
  const { data: poItem } = await db()
    .from("purchase_order_items")
    .select("quantity_units")
    .eq("id", data.purchaseOrderItemId)
    .eq("purchase_order_id", session.purchase_order_id)
    .maybeSingle();

  if (!poItem) throw new ReceivingError(404, "Item não pertence a esta PO.");

  const expectedQty = poItem.quantity_units;

  if (data.acceptedQty + data.damagedQty > data.receivedQty) {
    throw new ReceivingError(400, "accepted + damaged não pode exceder received.");
  }

  const photos = data.photos || [];
  if (photos.length > MAX_PHOTOS_PER_ITEM) {
    throw new ReceivingError(400, `Máximo de ${MAX_PHOTOS_PER_ITEM} fotos por item.`);
  }

  const { data: item, error } = await db()
    .from("receiving_items")
    .upsert(
      {
        receiving_session_id: sessionId,
        purchase_order_item_id: data.purchaseOrderItemId,
        master_product_id: data.masterProductId,
        expected_qty: expectedQty,
        received_qty: data.receivedQty,
        accepted_qty: data.acceptedQty,
        damaged_qty: data.damagedQty,
        is_swapped: data.isSwapped || false,
        swapped_product_id: data.swappedProductId || null,
        photos,
        notes: data.notes || null,
      },
      { onConflict: "receiving_session_id,purchase_order_item_id" },
    )
    .select()
    .single();

  if (error) throw new ReceivingError(500, error.message);
  return item;
}

export async function completeReceiving(sessionId) {
  const { data: session } = await db()
    .from("receiving_sessions")
    .select("id, status, purchase_order_id")
    .eq("id", sessionId)
    .eq("status", "in_progress")
    .maybeSingle();

  if (!session) throw new ReceivingError(404, "Sessão não encontrada ou já finalizada.");

  const { data: items } = await db()
    .from("receiving_items")
    .select("*")
    .eq("receiving_session_id", sessionId);

  if (!items || items.length === 0) {
    throw new ReceivingError(400, "Nenhum item conferido nesta sessão.");
  }

  await db()
    .from("receiving_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId);

  // Update PO status
  const totalExpected = items.reduce((s, i) => s + i.expected_qty, 0);
  const totalReceived = items.reduce((s, i) => s + i.received_qty, 0);
  const poStatus = totalReceived >= totalExpected ? "received" : "partial";

  await db()
    .from("supplier_purchase_orders")
    .update({
      status: poStatus,
      received_at: new Date().toISOString(),
    })
    .eq("id", session.purchase_order_id);

  // Update individual PO item received_qty
  for (const item of items) {
    await db()
      .from("purchase_order_items")
      .update({ received_qty: item.received_qty, received_at: new Date().toISOString() })
      .eq("id", item.purchase_order_item_id);
  }

  // Build allocation inputs (returned to admin for review — NOT persisted)
  const received = items.map((i) => ({
    masterProductId: i.master_product_id,
    acceptedQty: i.accepted_qty,
  }));

  // Fetch pending shipments that need these products
  const productIds = [...new Set(items.map((i) => i.master_product_id))];
  const { data: pendingItems, error: pendErr } = await db()
    .from("order_items")
    .select(`
      id,
      shipment_id,
      order_id,
      master_product_id,
      qty,
      orders(created_at),
      order_shipments!inner(promised_to, status)
    `)
    .in("master_product_id", productIds)
    .in("order_shipments.status", ["aguardando_disponibilidade", "preparando"])
    .not("shipment_id", "is", null);

  if (pendErr) throw new ReceivingError(500, `Erro ao buscar pedidos pendentes: ${pendErr.message}`);

  const pending = (pendingItems ?? []).map((p) => ({
    orderItemId: p.id,
    shipmentId: p.shipment_id,
    orderId: p.order_id,
    masterProductId: p.master_product_id,
    quantity: p.qty,
    promisedTo: p.order_shipments?.promised_to || null,
    createdAt: p.orders?.created_at || null,
  }));

  // Compute shortages for exceptions
  const shortages = items
    .filter((i) => i.expected_qty > i.received_qty)
    .map((i) => ({
      masterProductId: i.master_product_id,
      shortageQty: i.expected_qty - i.received_qty,
      productName: null,
    }));

  const damages = items
    .filter((i) => i.damaged_qty > 0)
    .map((i) => ({
      masterProductId: i.master_product_id,
      damagedQty: i.damaged_qty,
    }));

  const summary = {
    totalExpected,
    totalReceived,
    totalAccepted: items.reduce((s, i) => s + i.accepted_qty, 0),
    totalDamaged: items.reduce((s, i) => s + i.damaged_qty, 0),
  };

  // Record performance events (idempotent — safe on retry)
  const { data: po } = await db()
    .from("supplier_purchase_orders")
    .select("supplier_id")
    .eq("id", session.purchase_order_id)
    .maybeSingle();
  if (po?.supplier_id) {
    await recordReceivingResult(po.supplier_id, sessionId, summary);
    const swaps = items.filter((i) => i.is_swapped);
    for (const sw of swaps) {
      await recordReceivingSwap(po.supplier_id, sessionId, {
        originalProductId: sw.master_product_id,
        swappedProductId: sw.swapped_product_id,
      });
    }
  }

  return {
    sessionId,
    poStatus,
    receivedItems: items,
    allocationInputs: { received, pending },
    shortages,
    damages,
    summary,
  };
}

export async function getSessionAllocationPlan(sessionId) {
  const { data: session } = await db()
    .from("receiving_sessions")
    .select("id, status, purchase_order_id, allocation_confirmed_at")
    .eq("id", sessionId)
    .eq("status", "completed")
    .maybeSingle();

  if (!session) throw new ReceivingError(404, "Sessão não encontrada ou não está completada.");
  if (session.allocation_confirmed_at) throw new ReceivingError(409, "Alocação já confirmada.");

  const { data: items } = await db()
    .from("receiving_items")
    .select("*")
    .eq("receiving_session_id", sessionId);

  if (!items || items.length === 0) {
    throw new ReceivingError(400, "Nenhum item conferido nesta sessão.");
  }

  const received = items.map((i) => ({
    masterProductId: i.master_product_id,
    acceptedQty: i.accepted_qty,
  }));

  const productIds = [...new Set(items.map((i) => i.master_product_id))];
  const { data: pendingItems, error: pendErr } = await db()
    .from("order_items")
    .select(`
      id,
      shipment_id,
      order_id,
      master_product_id,
      qty,
      orders(created_at),
      order_shipments!inner(promised_to, status)
    `)
    .in("master_product_id", productIds)
    .in("order_shipments.status", ["aguardando_disponibilidade", "preparando"])
    .not("shipment_id", "is", null);

  if (pendErr) throw new ReceivingError(500, `Erro ao buscar pedidos pendentes: ${pendErr.message}`);

  const pending = (pendingItems ?? []).map((p) => ({
    orderItemId: p.id,
    shipmentId: p.shipment_id,
    orderId: p.order_id,
    masterProductId: p.master_product_id,
    quantity: p.qty,
    promisedTo: p.order_shipments?.promised_to || null,
    createdAt: p.orders?.created_at || null,
  }));

  const summary = {
    totalExpected: items.reduce((s, i) => s + i.expected_qty, 0),
    totalReceived: items.reduce((s, i) => s + i.received_qty, 0),
    totalAccepted: items.reduce((s, i) => s + i.accepted_qty, 0),
    totalDamaged: items.reduce((s, i) => s + i.damaged_qty, 0),
  };

  return { sessionId, received, pending, items, summary };
}

export async function confirmAllocation(sessionId, allocations, actorId) {
  const { data, error } = await db().rpc("confirm_allocation_atomic", {
    p_session_id: sessionId,
    p_allocations: allocations,
    p_actor_id: actorId,
  });

  if (error) {
    const hint = error.hint || "";
    const msg = error.message || "Erro desconhecido.";
    if (hint === "ALREADY_CONFIRMED") throw new ReceivingError(409, msg);
    if (hint === "STOCK_CONFLICT") throw new ReceivingError(409, msg);
    if (hint === "NOT_FOUND" || hint === "BAD_STATUS") throw new ReceivingError(404, msg);
    throw new ReceivingError(500, msg);
  }

  return data;
}
