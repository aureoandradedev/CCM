import type { Metadata } from "next";

import { CheckoutForm, type SavedAddress } from "@/components/checkout/checkout-form";
import { getCdPickupInfo, getSiteSettings } from "@/lib/data/catalog";
import { getCurrentUser } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

async function getUserAddresses(userId: string): Promise<SavedAddress[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("addresses")
    .select("id, label, cep, street, number, complement, district, city, state, reference, is_default")
    .eq("profile_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as SavedAddress[];
}

export default async function CheckoutPage() {
  const [user, settings, cdInfo] = await Promise.all([getCurrentUser(), getSiteSettings(), getCdPickupInfo()]);
  const b = settings.bloqueio;
  const bloqueado = b.ativo && (!b.data || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) < b.data);
  const savedAddresses = user ? await getUserAddresses(user.id) : [];
  return <CheckoutForm perfil={user ? { fullName: user.fullName, document: user.document, phone: user.phone, email: user.email } : null} bloqueio={bloqueado ? b : null} cdInfo={cdInfo} savedAddresses={savedAddresses} deliveryArea={settings.deliveryArea} />;
}
