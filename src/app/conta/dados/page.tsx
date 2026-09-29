import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/account/profile-form";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Meus dados", robots: { index: false } };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/conta?next=/conta/dados");
  return (
    <div className="max-w-2xl">
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Meus dados</h1>
      <p className="mt-1 mb-6 text-sm text-brand-ink-soft">Usados para a nota fiscal do fornecedor e para o contato sobre a entrega.</p>
      <ProfileForm fullName={user.fullName} document={user.document} phone={user.phone} email={user.email} />
    </div>
  );
}
