import type { Metadata } from "next";

import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getSiteSettings } from "@/lib/data/catalog";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

export default async function CheckoutPage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSiteSettings()]);
  const b = settings.bloqueio;
  const bloqueado = b.ativo && (!b.data || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) < b.data);
  return <CheckoutForm perfil={user ? { fullName: user.fullName, document: user.document, phone: user.phone, email: user.email } : null} bloqueio={bloqueado ? b : null} />;
}
