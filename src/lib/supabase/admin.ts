import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function createAdminClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada. Adicione em .env.local (nunca em NEXT_PUBLIC_*).",
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Release reserved credit on order cancellation.
 * No-op when no reservation exists. Non-fatal (swallows errors).
 */
export async function releaseOrderCreditOnCancel(orderId: string, reason: string) {
  try {
    const admin = createAdminClient();
    const { data: reserved } = await admin
      .from("credit_ledger")
      .select("id, amount_centavos")
      .eq("order_id", orderId)
      .eq("movement_type", "credit_reserved")
      .limit(1);
    if (!reserved?.length) return;
    const entry = reserved[0];
    await admin.rpc("release_credit", {
      p_order_id: orderId,
      p_amount_centavos: entry.amount_centavos,
      p_reference_id: entry.id,
      p_reason: reason,
      p_idempotency_key: `credit_rel:${orderId}:${entry.id}`,
    });
  } catch {}
}
