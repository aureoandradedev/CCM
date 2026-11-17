import { db } from "./supabase.mjs";

export async function updateShipmentStatus(shipmentId, newStatus, actor) {
  const { data: ship, error: fetchErr } = await db()
    .from("order_shipments")
    .select("status")
    .eq("id", shipmentId)
    .maybeSingle();
  if (fetchErr || !ship) throw Object.assign(new Error("Shipment não encontrado."), { status: 404 });

  const { data, error } = await db().rpc("transition_shipment_status", {
    p_shipment_id: shipmentId,
    p_new_status: newStatus,
    p_expected: ship.status,
    p_actor_kind: actor?.kind || "admin",
    p_actor_id: actor?.id || null,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (data?.error) {
    const code = data.current_status ? 409 : 400;
    throw Object.assign(new Error(data.error), { status: code, currentStatus: data.current_status });
  }
  return data;
}

export async function setShipmentTracking(shipmentId, trackingCode, carrier, actor) {
  const { data, error } = await db().rpc("set_shipment_tracking", {
    p_shipment_id: shipmentId,
    p_tracking_code: trackingCode || null,
    p_carrier: carrier || null,
    p_actor_kind: actor?.kind || "admin",
    p_actor_id: actor?.id || null,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (data?.error) throw Object.assign(new Error(data.error), { status: 404 });
  return data;
}

export async function logShipmentOccurrence(shipmentId, type, description, actor) {
  const { data, error } = await db().rpc("log_shipment_occurrence", {
    p_shipment_id: shipmentId,
    p_type: type,
    p_description: description || "",
    p_actor_kind: actor?.kind || "admin",
    p_actor_id: actor?.id || null,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (data?.error) throw Object.assign(new Error(data.error), { status: 400 });
  return data;
}
