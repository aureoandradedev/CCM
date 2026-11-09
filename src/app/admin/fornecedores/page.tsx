import Link from "next/link";
import { UserCheck } from "lucide-react";

import { SuppliersAdmin } from "@/components/admin/suppliers-admin";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminSuppliers, adminPendingRequestCount, configured } from "@/lib/admin/data";

export default async function AdminSuppliersPage() {
  if (!configured()) return <NotConfigured />;
  const [suppliers, pendingCount] = await Promise.all([
    adminSuppliers(),
    adminPendingRequestCount(),
  ]);
  return (
    <>
      <PageTitle title="Fornecedores" subtitle="Parceiros que fornecem os produtos. A integração automática é fase futura." />

      {pendingCount > 0 ? (
        <Link
          href="/admin/fornecedores/solicitacoes"
          className="mb-4 flex items-center gap-2 rounded-xl border border-brand-navy/20 bg-brand-navy/5 px-4 py-3 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy/10 dark:text-foreground"
        >
          <UserCheck className="size-5" />
          {pendingCount} solicitação(ões) de acesso pendente(s)
        </Link>
      ) : null}

      <SuppliersAdmin suppliers={suppliers} />
    </>
  );
}
