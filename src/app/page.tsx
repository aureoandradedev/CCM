import { BrandsStrip } from "@/components/home/brands-strip";
import { DepartmentRail } from "@/components/home/department-rail";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { HowItWorks } from "@/components/home/how-it-works";
import { InspirationGrid } from "@/components/home/inspiration-grid";
import { Newsletter } from "@/components/home/newsletter";
import { PromoBanners, type PromoBanner } from "@/components/home/promo-banners";
import { QuickLinks } from "@/components/home/quick-links";
import { ProductRail } from "@/components/product/product-rail";
import { getBanners, getBrands, getCategories, getInspirations, getQuickLinks, getShowcase } from "@/lib/data/catalog";
import { unsplash } from "@/lib/data/mock";

const PROMOS: PromoBanner[] = [
  {
    id: "kit-obra",
    eyebrow: "Começo de obra",
    title: "Cimento, areia e bloco com preço de atacado",
    subtitle: "Feche o básico da obra em um pedido só e receba direto do distribuidor.",
    cta: "Montar kit obra",
    href: "/categoria/materiais-basicos",
    image: unsplash("1773394089934-3e29f2a3d6a9", 1200),
    tone: "navy",
  },
  {
    id: "pisos",
    eyebrow: "Acabamento",
    title: "Porcelanato a partir de R$ 69,90/m²",
    subtitle: "Portobello e Eliane com desconto progressivo por metragem.",
    cta: "Ver pisos",
    href: "/categoria/pisos-e-revestimentos",
    image: unsplash("1706629503571-c165023a7792", 1200),
    tone: "orange",
  },
];

export default async function HomePage() {
  const [banners, quickLinks, categories, ofertas, maisVendidos, atacado, tintas, loucas, inspirations, brands] = await Promise.all([
    getBanners(),
    getQuickLinks(),
    getCategories(),
    getShowcase("ofertas", 10),
    getShowcase("mais-vendidos", 10),
    getShowcase("atacado", 10),
    getShowcase({ category: "tintas-e-acessorios" }, 8),
    getShowcase({ category: "loucas-e-metais" }, 8),
    getInspirations(),
    getBrands(),
  ]);

  return (
    <div className="space-y-12 pt-4 md:space-y-16 md:pt-6">
      <HeroCarousel banners={banners} />
      <QuickLinks links={quickLinks} />
      <DepartmentRail categories={categories} />
      <ProductRail eyebrow="Só esta semana" title="Ofertas da semana" subtitle="Preço de fábrica com desconto extra no Pix" href="/ofertas" products={ofertas} priorityFirst={4} />
      <PromoBanners banners={PROMOS} />
      <ProductRail eyebrow="Compre em quantidade" title="Mais vendidos no atacado" subtitle="O preço cai sozinho ao atingir a quantidade mínima" href="/atacado" hrefLabel="Ver tudo do atacado" products={atacado} />
      <HowItWorks />
      <ProductRail eyebrow="Quem constrói recomenda" title="Os mais vendidos" href="/busca?ordenar=relevance" products={maisVendidos} />
      <InspirationGrid items={inspirations} />
      <ProductRail eyebrow="Pintura" title="Renove a casa com tinta premium" href="/categoria/tintas-e-acessorios" hrefLabel="Ver tintas" products={tintas} />
      <ProductRail eyebrow="Banheiro e cozinha" title="Louças e metais de fábrica" href="/categoria/loucas-e-metais" hrefLabel="Ver louças e metais" products={loucas} />
      <BrandsStrip brands={brands.slice(0, 20)} />
      <Newsletter />
    </div>
  );
}
