import { notFound } from "next/navigation";

import { ProductForm } from "@/components/admin/product-form";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminBrands, adminCategories, adminGetProduct, adminSuppliers, configured } from "@/lib/admin/data";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!configured()) return <NotConfigured />;
  const [product, categories, suppliers, brands] = await Promise.all([adminGetProduct(id), adminCategories(), adminSuppliers(), adminBrands()]);
  if (!product) notFound();
  return (
    <>
      <PageTitle title={product.name} subtitle={`${product.sku} · atualizado ${new Date(product.updated_at).toLocaleString("pt-BR")}`} />
      <ProductForm product={product} id={product.id} categories={categories} suppliers={suppliers} brands={brands.map((b) => b.name)} />
    </>
  );
}
