import { AvisoForm, BannerList, BestSellersForm, BloqueioForm } from "@/components/admin/content-forms";
import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminBanners, adminProductIndex, adminSettings, configured } from "@/lib/admin/data";

export default async function AdminContent() {
  if (!configured()) return <NotConfigured />;
  const [banners, settings, index] = await Promise.all([adminBanners(), adminSettings(), adminProductIndex()]);
  return (
    <>
      <PageTitle title="Conteúdo do site" subtitle="Carrossel da home, bloqueio de entregas, aviso do topo e vitrine de mais vendidos." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title="Carrossel da home">
          <BannerList banners={banners} />
        </Card>
        <div className="space-y-6">
          <Card title="Bloqueio de entregas">
            <BloqueioForm value={settings.entrega_bloqueio} />
          </Card>
          <Card title="Aviso do topo">
            <AvisoForm value={settings.avisos.topo} />
          </Card>
          <Card title="Mais vendidos (home)">
            <BestSellersForm ids={settings.best_sellers.ids} index={index} />
          </Card>
        </div>
      </div>
    </>
  );
}
