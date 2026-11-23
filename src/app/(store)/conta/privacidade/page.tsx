import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download, Trash2 } from "lucide-react";

import { DeleteAccountForm, ExportDataButton } from "@/components/account/privacy-controls";
import { getCurrentUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Privacidade", robots: { index: false } };

export default async function PrivacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/conta?next=/conta/privacidade");

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Privacidade e dados</h1>
        <p className="mt-1 text-sm text-brand-ink-soft">Gerencie seus dados pessoais conforme a LGPD (Lei 13.709/2018).</p>
      </div>

      <section className="space-y-3 rounded-2xl border border-brand-line bg-card p-6">
        <div className="flex items-center gap-2">
          <Download className="size-5 text-brand-navy dark:text-brand-yellow" />
          <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Exportar meus dados</h2>
        </div>
        <p className="text-sm text-brand-ink-soft">Baixe uma cópia dos seus dados pessoais: perfil, endereços e pedidos. O arquivo é gerado em formato JSON.</p>
        <ExportDataButton />
      </section>

      <section className="space-y-3 rounded-2xl border border-brand-line bg-card p-6">
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-brand-red" />
          <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Excluir minha conta</h2>
        </div>
        <p className="text-sm text-brand-ink-soft">Solicite a remoção dos seus dados pessoais. Dados vinculados a pedidos serão anonimizados. O histórico operacional será preservado quando necessário por obrigação legal, fiscal, regulatória ou para defesa de direitos.</p>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}
