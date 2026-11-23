import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { adminSupplierById, configured } from "@/lib/admin/data";
import { AdminImportClient } from "./_import-client";

export default async function AdminImportPage({ params }: { params: Promise<{ id: string }> }) {
  if (!configured()) return <NotConfigured />;
  const { id } = await params;
  const supplier = await adminSupplierById(id);
  if (!supplier) notFound();

  return (
    <>
      <Link
        href={`/admin/fornecedores/${supplier.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> {supplier.name}
      </Link>

      <PageTitle
        title="Importar catálogo"
        subtitle={`Adicionar produtos ao catálogo de ${supplier.name}.`}
      />

      <div className="mt-6">
        <AdminImportClient supplierId={supplier.id} supplierName={supplier.name} />
      </div>
    </>
  );
}
