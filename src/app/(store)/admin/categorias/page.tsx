import { CategoriesAdmin } from "@/components/admin/suppliers-admin";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminCategories, configured } from "@/lib/admin/data";

export default async function AdminCategoriesPage() {
  if (!configured()) return <NotConfigured />;
  const categories = await adminCategories();
  return (
    <>
      <PageTitle title="Categorias" subtitle="Departamentos do menu e suas subcategorias." />
      <CategoriesAdmin categories={categories} />
    </>
  );
}
