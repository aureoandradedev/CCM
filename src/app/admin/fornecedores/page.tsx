import { SuppliersAdmin } from "@/components/admin/suppliers-admin";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminSuppliers, configured } from "@/lib/admin/data";

export default async function AdminSuppliersPage() {
  if (!configured()) return <NotConfigured />;
  const suppliers = await adminSuppliers();
  return (
    <>
      <PageTitle title="Fornecedores" subtitle="Parceiros que fornecem os produtos. A integração automática é fase futura." />
      <SuppliersAdmin suppliers={suppliers} />
    </>
  );
}
