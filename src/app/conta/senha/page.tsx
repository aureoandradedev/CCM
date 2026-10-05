import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PasswordForm } from "@/components/account/profile-form";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Trocar senha", robots: { index: false } };

export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/conta?next=/conta/senha");
  return (
    <div className="max-w-xl">
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Trocar senha</h1>
      <p className="mt-1 mb-6 text-sm text-brand-ink-soft">Escolha uma senha nova para a sua conta.</p>
      <PasswordForm />
    </div>
  );
}
