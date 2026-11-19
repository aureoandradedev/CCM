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
