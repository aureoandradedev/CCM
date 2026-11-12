import Link from "next/link";

import { PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { getRegistrationRequests } from "../invite-actions";
import { RegistrationRequestsClient } from "./_requests-client";

export default async function SolicitacoesPage() {
  if (!configured()) return <div className="p-6 text-sm text-brand-fg/60">Supabase não configurado.</div>;

  const requests = await getRegistrationRequests();
  const pending = requests.filter((r) => r.status === "pending");
  const others = requests.filter((r) => r.status !== "pending");

  return (
    <>
      <PageTitle title="Solicitações de cadastro" subtitle={`${pending.length} pendente(s)`}>
        <Link href="/admin/fornecedores" className="text-xs font-semibold text-brand-navy hover:underline dark:text-foreground">
          Voltar para Fornecedores
        </Link>
      </PageTitle>
      <RegistrationRequestsClient pending={pending} others={others} />
    </>
  );
}
