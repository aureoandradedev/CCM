import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface SupplierSession {
  userId: string;
  supplierId: string;
  supplierName: string;
}

export const getSupplierSession = cache(async (): Promise<SupplierSession | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("supplier_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.supplier_id) return null;

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, trade_name, name")
    .eq("id", profile.supplier_id)
    .maybeSingle();

  if (!supplier) return null;

  return {
    userId: user.id,
    supplierId: supplier.id,
    supplierName: supplier.trade_name || supplier.name,
  };
});

export async function assertSupplier(): Promise<SupplierSession> {
  const session = await getSupplierSession();
  if (!session) redirect("/conta?next=/fornecedores/pedidos&erro=permissao");
  return session;
}
