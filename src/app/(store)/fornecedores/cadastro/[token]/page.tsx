import type { Metadata } from "next";

import { validateInviteToken } from "@/app/admin/fornecedores/invite-actions";
import { RegistrationForm } from "./_registration-form";

export const metadata: Metadata = {
  title: "Cadastro de Fornecedor",
  description: "Preencha seus dados para se tornar fornecedor parceiro da Multigiro Central de Compras.",
  robots: { index: false, follow: false },
};

export default async function SupplierRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const validation = await validateInviteToken(token);

  if (!validation.valid) {
    const messages: Record<string, { title: string; description: string }> = {
      not_found: { title: "Convite não encontrado", description: "Este link de cadastro não é válido. Verifique se copiou o link corretamente ou solicite um novo convite ao administrador." },
      already_used: { title: "Convite já utilizado", description: "Este link de cadastro já foi utilizado. Cada convite permite apenas um cadastro." },
      expired: { title: "Convite expirado", description: "Este link de cadastro expirou. Solicite um novo convite ao administrador." },
      revoked: { title: "Convite cancelado", description: "Este link de cadastro foi cancelado pelo administrador." },
    };
    const msg = messages[validation.reason ?? ""] ?? messages.not_found;

    return (
      <div className="flex min-h-[60dvh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-brand-line bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="size-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h1 className="font-heading text-xl font-bold text-brand-navy dark:text-foreground">{msg.title}</h1>
          <p className="mt-2 text-sm text-brand-ink-soft">{msg.description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-ccm py-6 md:py-10">
      <header className="mb-8 max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">Cadastro de fornecedor</p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-brand-navy dark:text-foreground md:text-3xl">
          Preencha seus dados
        </h1>
        <p className="mt-2 text-sm text-brand-ink-soft">
          Informe os dados da sua empresa e as condições comerciais que pratica. Após o envio, o administrador analisará sua solicitação.
        </p>
      </header>
      <RegistrationForm token={token} />
    </div>
  );
}
