import { DiscountsForm } from "@/components/admin/settings-forms";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminCategories, adminSettings, configured } from "@/lib/admin/data";

export default async function AdminDiscounts() {
  if (!configured()) return <NotConfigured />;
  const [settings, categories] = await Promise.all([adminSettings(), adminCategories()]);
  return (
    <>
      <PageTitle title="Descontos" subtitle="Pix, primeira compra e desconto por seção. O servidor de pedidos recalcula tudo com estas regras." />
      <Card>
        <DiscountsForm value={settings.descontos} categories={categories} />
      </Card>
    </>
  );
}
