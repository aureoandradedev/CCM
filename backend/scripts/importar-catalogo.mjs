/**
 * Importa o catálogo (src/lib/data/mock.ts) para o Supabase via service role
 * e, com --imagens, busca a foto real de cada produto no QRofertas.
 *
 *   node scripts/importar-catalogo.mjs            # só dados
 *   node scripts/importar-catalogo.mjs --imagens  # dados + fotos (QROFERTAS_* no .env)
 *   node scripts/importar-catalogo.mjs --so-imagens
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { db } from "../lib/supabase.mjs";
import { buscarEGravarImagem } from "../lib/imagens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const comImagens = args.has("--imagens") || args.has("--so-imagens");
const soImagens = args.has("--so-imagens");

const { mockCatalog } = await import(pathToFileURL(resolve(here, "../../src/lib/data/mock.ts")).href);

async function upsert(tabela, linhas, chave) {
  if (!linhas.length) return;
  const { error } = await db().from(tabela).upsert(linhas, { onConflict: chave });
  if (error) throw new Error(`${tabela}: ${error.message}`);
  console.log(`✓ ${tabela}: ${linhas.length}`);
}

if (!soImagens) {
  await upsert("suppliers", mockCatalog.suppliers.map((s) => ({ id: s.id, name: s.name, lead_time_days: s.leadTimeDays, city: s.city ?? null })), "id");
  await upsert("categories", mockCatalog.categories.map((c, i) => ({ slug: c.slug, name: c.name, icon: c.icon, description: c.description, image: c.image ?? null, tone: c.tone ?? null, sort: i })), "slug");
  await upsert("subcategories", mockCatalog.categories.flatMap((c) => c.children.map((s, j) => ({ slug: s.slug, category_slug: c.slug, name: s.name, sort: j }))), "slug");
  const marcas = new Map(mockCatalog.brands.map((b) => [b.slug, b.name]));
  for (const p of mockCatalog.products) if (!marcas.has(p.brandSlug)) marcas.set(p.brandSlug, p.brand);
  await upsert("brands", [...marcas].map(([slug, name]) => ({ slug, name })), "slug");

  // não sobrescreve fotos já buscadas (só define images quando o produto é novo)
  const { data: existentes } = await db().from("products").select("id, images, image_source");
  const jaTemFoto = new Map((existentes || []).map((p) => [p.id, p]));
  const produtos = mockCatalog.products.map((p, i) => {
    const ex = jaTemFoto.get(p.id);
    const manterFoto = ex && ex.image_source && ex.image_source !== "placeholder";
    return {
      id: p.id, slug: p.slug, sku: p.sku, name: p.name, brand_slug: p.brandSlug, brand_name: p.brand,
      category_slug: p.categorySlug, subcategory_slug: p.subcategorySlug ?? null, supplier_id: p.supplier?.id ?? null,
      unit: p.unit, pack_info: p.packInfo ?? null, retail_price: p.retailPrice, wholesale_price: p.wholesalePrice ?? null,
      wholesale_min_qty: p.wholesaleMinQty ?? null, list_price: p.listPrice ?? null, pix_discount_pct: p.pixDiscountPct ?? null,
      ...(manterFoto ? {} : { images: p.images, image_source: "placeholder" }),
      rating: p.rating ?? null, review_count: p.reviewCount ?? 0, badges: p.badges ?? [], short_description: p.shortDescription,
      description: p.description ?? null, specs: p.specs ?? [], stock_status: p.stockStatus, tags: p.tags ?? [], yield_hint: p.yieldHint ?? null, sort: i, active: true,
    };
  });
  await upsert("products", produtos, "id");
  await upsert("banners", mockCatalog.banners.map((b, i) => ({ id: b.id, eyebrow: b.eyebrow ?? null, title: b.title, subtitle: b.subtitle ?? null, cta: b.cta, href: b.href, image: b.image, theme: b.theme, variant: b.variant ?? "photo", sort: i, active: true })), "id");
}

if (comImagens) {
  const { data: produtos } = await db().from("products").select("id, sku, name, images, image_manual").eq("active", true).order("sort");
  const alvo = (produtos || []).filter((p) => !p.image_manual && (!p.images?.length || /unsplash\.com/.test(p.images[0])));
  console.log(`🖼️  buscando fotos para ${alvo.length} produto(s)...`);
  let ok = 0;
  for (const p of alvo) {
    try {
      const r = await buscarEGravarImagem(p);
      if (r.ok) ok++;
      console.log(r.ok ? `  ✓ ${p.name}` : `  ✗ ${p.name} (${r.motivo})`);
    } catch (e) {
      console.log(`  ✗ ${p.name}: ${e.message}`);
    }
  }
  console.log(`🖼️  fotos gravadas: ${ok}/${alvo.length}`);
}

console.log("pronto.");
