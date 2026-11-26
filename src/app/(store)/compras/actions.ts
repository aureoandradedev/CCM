"use server";

import { revalidatePath } from "next/cache";

import { assertRole } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ActionResult {
  ok?: string;
  error?: string;
}

async function run(
  fn: (sb: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<ActionResult | void>,
  paths: string[] = ["/compras"],
): Promise<ActionResult> {
  try {
    const user = await assertRole(["compras"]);
    const sb = await createClient();
    const r = (await fn(sb, user.id)) ?? {};
    for (const p of paths) revalidatePath(p, "layout");
    return r;
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

async function logEvent(
  sb: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  type: string,
  data: Record<string, unknown>,
  actorId: string,
) {
  await sb.from("order_events").insert({ order_id: orderId, type, data, actor_id: actorId });
}

export async function confirmOrder(orderId: string): Promise<ActionResult> {
  return run(async (sb, userId) => {
    const { data, error } = await sb.rpc("confirm_order", { p_order_id: orderId });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };
    await logEvent(sb, orderId, "confirmado-compras", { new_status: data.new_status }, userId);
    return { ok: `Pedido confirmado → ${data.new_status === "em-separacao" ? "em separação" : "aguardando pagamento"}.` };
  }, ["/compras", "/admin/pedidos"]);
}

export async function rejectOrder(orderId: string, motivo: string): Promise<ActionResult> {
  return run(async (sb, userId) => {
    const { data, error } = await sb.rpc("cancel_order_full", { p_order_id: orderId });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };
    // CCM Etapa 5: release CCM stock reservations on cancel
    try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: orderId }); } catch {}
    await logEvent(sb, orderId, "rejeitado-compras", { motivo }, userId);
    return { ok: "Pedido rejeitado e cancelado." };
  }, ["/compras", "/admin/pedidos"]);
}

export interface ItemDecision {
  item_id: string;
  qty_confirmed: number;
  removal_reason?: string;
}

// ─── Reminders ─────────────────────────────────────────────────────────────

export interface ReminderRow {
  id: string;
  order_id: string;
  reminder_no: number;
  channel: string;
  sent_at: string;
}

export async function fetchRemindersForOrders(orderIds: string[]): Promise<Record<string, ReminderRow[]>> {
  if (orderIds.length === 0) return {};
  await assertRole(["compras"]);
  const sb = await createClient();
  const { data } = await sb
    .from("confirmation_reminders")
    .select("*")
    .in("order_id", orderIds)
    .order("reminder_no", { ascending: true });
  const rows = (data ?? []) as ReminderRow[];
  const map: Record<string, ReminderRow[]> = {};
  for (const r of rows) {
    (map[r.order_id] ??= []).push(r);
  }
  return map;
}

export async function sendReminder(orderId: string, reminderNo: number): Promise<ActionResult> {
  return run(async (sb, userId) => {
    const { error } = await sb.from("confirmation_reminders").insert({
      order_id: orderId,
      reminder_no: reminderNo,
      channel: "internal",
      sent_by: userId,
    });
    if (error) {
      if (error.code === "23505") return { error: "Lembrete já enviado." };
      return { error: error.message };
    }
    await logEvent(sb, orderId, "lembrete-confirmacao", { reminder_no: reminderNo }, userId);
    return { ok: `Lembrete #${reminderNo} registrado.` };
  }, ["/compras/confirmacoes"]);
}

export async function confirmOrderPartial(
  orderId: string,
  items: ItemDecision[],
): Promise<ActionResult> {
  return run(async (sb, userId) => {
    const { data, error } = await sb.rpc("confirm_order_partial", {
      p_order_id: orderId,
      p_items: items,
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    const wasFullCancel = data.ok === true && !data.new_status;
    if (wasFullCancel) {
      await logEvent(sb, orderId, "rejeitado-compras", {
        motivo: "Todos os itens removidos na confirmação parcial",
        items_removed: items.length,
      }, userId);
      return { ok: "Todos os itens removidos — pedido cancelado." };
    }

    await logEvent(sb, orderId, "confirmado-compras-parcial", {
      new_status: data.new_status,
      items_confirmed: data.items_confirmed,
      items_removed: data.items_removed,
      stock_returned: data.stock_returned,
      new_subtotal: data.new_subtotal,
      new_freight: data.new_freight,
      new_total: data.new_total,
    }, userId);

    const statusLabel = data.new_status === "em-separacao" ? "em separação" : "aguardando pagamento";
    const removedMsg = data.items_removed > 0 ? ` (${data.items_removed} item(ns) removido(s))` : "";
    return { ok: `Pedido confirmado → ${statusLabel}${removedMsg}.` };
  }, ["/compras", "/admin/pedidos"]);
}
