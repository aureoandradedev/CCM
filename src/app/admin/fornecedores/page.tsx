import { SuppliersAdmin } from "@/components/admin/suppliers-admin";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminSuppliers, adminSuppliersWithActiveTerms, configured } from "@/lib/admin/data";

export default async function AdminSuppliersPage() {
  if (!configured()) return <NotConfigured />;
  const [suppliers, activeTermsSet] = await Promise.all([
    adminSuppliers(),
    adminSuppliersWithActiveTerms(),
  ]);
  return (
    <>
      <PageTitle title="Fornecedores" subtitle="Parceiros que fornecem os produtos." />
      <SuppliersAdmin suppliers={suppliers} supplierIdsWithTerms={[...activeTermsSet]} />
    </>
  );
}
