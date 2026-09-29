import { ProductForm } from "@/components/admin/product-form";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminBrands, adminCategories, adminSuppliers, configured, newProductId } from "@/lib/admin/data";

export default async function NewProduct() {
  if (!configured()) return <NotConfigured />;
  const [categories, suppliers, brands] = await Promise.all([adminCategories(), adminSuppliers(), adminBrands()]);
  const id = newProductId();
  return (
    <>
      <PageTitle title="Novo produto" />
      <ProductForm product={null} id={id} categories={categories} suppliers={suppliers} brands={brands.map((b) => b.name)} />
    </>
  );
}
