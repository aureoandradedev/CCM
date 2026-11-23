import type { Metadata } from "next";

import { PasswordForm } from "@/components/account/profile-form";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Redefinir senha", robots: { index: false } };

/** Destino do link de recuperação enviado por e-mail (o callback já criou a sessão). */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ href: "/conta", label: "Minha conta" }, { label: "Redefinir senha" }]} />
      <div className="mx-auto mt-6 max-w-xl">
        <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Redefinir senha</h1>
        {user ? (
          <>
            <p className="mt-1 mb-6 text-sm text-brand-ink-soft">Conta {user.email}. Defina a nova senha.</p>
            <PasswordForm />
          </>
        ) : (
          <p className="mt-4 rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">O link de redefinição expirou. Peça um novo em Minha conta › Recuperar senha.</p>
        )}
      </div>
    </div>
  );
}
