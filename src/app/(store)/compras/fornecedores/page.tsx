import { SuppliersAdmin } from "@/components/admin/suppliers-admin";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminSuppliers, adminSuppliersWithActiveTerms, configured } from "@/lib/admin/data";
import { getSupplierListSummaries, type SupplierListSummary } from "@/lib/admin/supplier-bi-data";

export default async function ComprasFornecedoresPage() {
  if (!configured()) return <NotConfigured />;
  const [suppliers, activeTermsSet, summariesMap] = await Promise.all([
    adminSuppliers(),
    adminSuppliersWithActiveTerms(),
    getSupplierListSummaries(),
  ]);

  const summaries: Record<string, SupplierListSummary> = {};
  for (const [k, v] of summariesMap) summaries[k] = v;

  return (
    <>
      <PageTitle title="Fornecedores" subtitle="Parceiros que fornecem os produtos." />
      <SuppliersAdmin
        suppliers={suppliers}
        supplierIdsWithTerms={[...activeTermsSet]}
        summaries={summaries}
        basePath="/compras/fornecedores"
        readOnly
      />
    </>
  );
}
