"use server";

import { revalidatePath } from "next/cache";

import { assertRole } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

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
    await logEvent(sb, orderId, "rejeitado-compras", { motivo }, userId);
    return { ok: "Pedido rejeitado e cancelado." };
  }, ["/compras", "/admin/pedidos"]);
}
