import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { adminAccessRequests, configured } from "@/lib/admin/data";
import { AccessRequestsQueue } from "./_queue";

export default async function AccessRequestsPage() {
  if (!configured()) return <NotConfigured />;
  const requests = await adminAccessRequests("all");
  const pending = requests.filter((r) => r.status === "pending");
  const processed = requests.filter((r) => r.status !== "pending");

  return (
    <>
      <Link
        href="/admin/fornecedores"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Fornecedores
      </Link>

      <PageTitle
        title="Solicitações de acesso"
        subtitle={`${pending.length} pendente(s)`}
      />

      <div className="mt-6">
        <AccessRequestsQueue pending={pending} processed={processed} />
      </div>
    </>
  );
}
