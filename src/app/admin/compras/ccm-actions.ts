"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok?: string;
  error?: string;
  data?: unknown;
}

async function run(
  fn: (
    sb: Awaited<ReturnType<typeof createClient>>,
    adminId: string,
  ) => Promise<ActionResult | void>,
): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const sb = await createClient();
    const r = (await fn(sb, admin.id)) ?? {};
    revalidatePath("/admin/compras", "layout");
    return r;
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function approvePriceChange(
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const logId = str(fd, "logId");
  if (!logId) return { error: "Log obrigatório." };

  return run(async (sb, adminId) => {
    const { data: log } = await sb
      .from("price_change_log")
      .select("*")
      .eq("id", logId)
      .eq("blocked", true)
      .is("approved_by", null)
      .maybeSingle();

    if (!log) return { error: "Alteração não encontrada ou já processada." };

    const { error: updateErr } = await sb
      .from("products")
      .update({ retail_price: log.new_price_centavos / 100 })
      .eq("id", log.product_id);
    if (updateErr) return { error: updateErr.message };

    const { error: logErr } = await sb
      .from("price_change_log")
      .update({
        blocked: false,
        auto_applied: false,
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", logId);
    if (logErr) return { error: logErr.message };

    return { ok: "Preço aprovado e aplicado." };
  });
}

export async function rejectPriceChange(
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const logId = str(fd, "logId");
  const action = str(fd, "action");
  if (!logId) return { error: "Log obrigatório." };

  return run(async (sb, adminId) => {
    const { data: log } = await sb
      .from("price_change_log")
      .select("*")
      .eq("id", logId)
      .eq("blocked", true)
      .is("approved_by", null)
      .maybeSingle();

    if (!log) return { error: "Alteração não encontrada ou já processada." };

    if (action === "deactivate") {
      await sb
        .from("products")
        .update({ active: false })
        .eq("id", log.product_id);
    }

    await sb
      .from("price_change_log")
      .update({
        approved_by: adminId,
        approved_at: new Date().toISOString(),
        block_reason: action === "deactivate" ? "Tirado da venda" : "Mantido preço anterior",
      })
      .eq("id", logId);

    return {
      ok: action === "deactivate" ? "Produto tirado da venda." : "Preço mantido.",
    };
  });
}
