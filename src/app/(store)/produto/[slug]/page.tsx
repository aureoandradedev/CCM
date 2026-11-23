import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductBadges } from "@/components/product/badges";
import { BuyBox } from "@/components/product/buy-box";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductRail } from "@/components/product/product-rail";
import { Rating } from "@/components/product/rating";
import { getCategory, getProductBySlug, getProducts, getRelatedProducts } from "@/lib/data/catalog";
import { offerDiscountPct } from "@/lib/pricing";
import { site } from "@/lib/site";
import { formatUnit } from "@/lib/utils/format";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const { items } = await getProducts({ limit: 200 });
  return items.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Produto não encontrado" };
  return {
    title: product.name,
    description: product.shortDescription,
    openGraph: { images: product.images.slice(0, 1), title: product.name, description: product.shortDescription },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [category, related] = await Promise.all([getCategory(product.categorySlug), getRelatedProducts(product, 10)]);
  const sub = category?.children.find((s) => s.slug === product.subcategorySlug);
  const off = offerDiscountPct(product);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    brand: { "@type": "Brand", name: product.brand },
    image: product.images,
    description: product.shortDescription,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: product.retailPrice,
      availability: product.stockStatus === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      seller: { "@type": "Organization", name: site.fullName },
    },
    ...(product.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviewCount ?? 1 } } : {}),
  };

  return (
    <div className="pt-4 md:pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="container-ccm">
        <Breadcrumbs
          items={[
            ...(category ? [{ href: `/categoria/${category.slug}`, label: category.name }] : []),
            ...(category && sub ? [{ href: `/categoria/${category.slug}?sub=${sub.slug}`, label: sub.name }] : []),
            { label: product.name },
          ]}
        />

        <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-10 xl:grid-cols-[1.1fr_0.9fr]">
          <ProductGallery images={product.images} name={product.name} />

          <div>
            <ProductBadges badges={product.badges} discountPct={off} max={3} />
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">
              <Link href={`/busca?marca=${product.brandSlug}`} className="hover:underline">
                {product.brand}
              </Link>
            </p>
            <h1 className="mt-1 font-heading text-[1.75rem] leading-tight font-extrabold tracking-tight text-brand-navy md:text-[2.2rem] dark:text-foreground">{product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
              <Rating value={product.rating} count={product.reviewCount} size="md" />
              <span>SKU {product.sku}</span>
              {product.packInfo ? <span>{product.packInfo}</span> : null}
              <span>Vendido por {formatUnit(product.unit)}</span>
            </div>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-brand-ink">{product.shortDescription}</p>

            <div className="mt-6">
              <BuyBox product={product} />
            </div>
          </div>
        </div>

        <section className="mt-12 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]" aria-label="Detalhes do produto">
          <div className="rounded-3xl border border-brand-line bg-card p-6 md:p-8">
            <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">Descrição</h2>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-brand-ink">{product.description ?? product.shortDescription}</p>
            {product.yieldHint ? (
              <div className="mt-5 rounded-2xl bg-brand-yellow-soft p-4 text-sm text-brand-navy dark:text-foreground">
                <p className="text-xs font-bold uppercase tracking-wider">Rendimento</p>
                <p className="mt-1">{product.yieldHint}</p>
              </div>
            ) : null}
            {product.tags?.length ? (
              <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Palavras-chave">
                {product.tags.map((t) => (
                  <li key={t}>
                    <Link href={`/busca?q=${encodeURIComponent(t)}`} className="inline-flex h-7 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-brand-ink hover:bg-brand-yellow-soft">
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-3xl border border-brand-line bg-card p-6 md:p-8">
            <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">Especificações</h2>
            <dl className="mt-3 divide-y divide-brand-line text-sm">
              {[
                ["Marca", product.brand],
                ["Unidade de venda", formatUnit(product.unit)],
                ...(product.packInfo ? [["Embalagem", product.packInfo]] : []),
                ...(product.specs ?? []).map((s) => [s.label, s.value]),
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-2.5">
                  <dt className="text-brand-ink-soft">{k}</dt>
                  <dd className="font-medium text-brand-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>

      {related.length ? (
        <div className="mt-14">
          <ProductRail eyebrow="Complete a compra" title="Quem comprou também levou" products={related} href={category ? `/categoria/${category.slug}` : undefined} hrefLabel={category ? `Ver ${category.name}` : undefined} />
        </div>
      ) : null}
    </div>
  );
}
