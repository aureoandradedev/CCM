/**
 * Gera `supabase/seed.sql` a partir do catálogo mock (src/lib/data/mock.ts).
 * Uso: `npm run seed:gen` (Node 22.6+ com type stripping nativo).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { mockCatalog } = await import(pathToFileURL(resolve(here, "../src/lib/data/mock.ts")).href);

const q = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const arr = (v) => (v && v.length ? `array[${v.map(q).join(",")}]::text[]` : "'{}'::text[]");
const json = (v) => `${q(JSON.stringify(v ?? []))}::jsonb`;

const lines = [];
lines.push("-- Gerado por scripts/gen-seed.mjs — não edite na mão.");
lines.push("begin;");

lines.push("\n-- fornecedores");
for (const s of mockCatalog.suppliers) {
  lines.push(
    `insert into public.suppliers (id, name, lead_time_days, city) values (${q(s.id)}, ${q(s.name)}, ${s.leadTimeDays}, ${q(s.city)})
  on conflict (id) do update set name = excluded.name, lead_time_days = excluded.lead_time_days, city = excluded.city;`,
  );
}

lines.push("\n-- categorias");
mockCatalog.categories.forEach((c, i) => {
  lines.push(
    `insert into public.categories (slug, name, icon, description, image, tone, sort) values (${q(c.slug)}, ${q(c.name)}, ${q(c.icon)}, ${q(c.description)}, ${q(c.image)}, ${q(c.tone)}, ${i})
  on conflict (slug) do update set name = excluded.name, icon = excluded.icon, description = excluded.description, image = excluded.image, tone = excluded.tone, sort = excluded.sort;`,
  );
  c.children.forEach((s, j) => {
    lines.push(
      `insert into public.subcategories (slug, category_slug, name, sort) values (${q(s.slug)}, ${q(c.slug)}, ${q(s.name)}, ${j})
  on conflict (slug) do update set name = excluded.name, category_slug = excluded.category_slug, sort = excluded.sort;`,
    );
  });
});

lines.push("\n-- marcas");
for (const b of mockCatalog.brands) {
  lines.push(`insert into public.brands (slug, name) values (${q(b.slug)}, ${q(b.name)}) on conflict (slug) do update set name = excluded.name;`);
}
// marcas usadas por produtos mas fora da lista
const known = new Set(mockCatalog.brands.map((b) => b.slug));
for (const p of mockCatalog.products) {
  if (!known.has(p.brandSlug)) {
    known.add(p.brandSlug);
    lines.push(`insert into public.brands (slug, name) values (${q(p.brandSlug)}, ${q(p.brand)}) on conflict (slug) do nothing;`);
  }
}

lines.push("\n-- produtos");
for (const p of mockCatalog.products) {
  lines.push(
    `insert into public.products (id, slug, sku, name, brand_slug, brand_name, category_slug, subcategory_slug, supplier_id, unit, pack_info, retail_price, wholesale_price, wholesale_min_qty, list_price, pix_discount_pct, images, rating, review_count, badges, short_description, description, specs, stock_status, tags, yield_hint)
values (${q(p.id)}, ${q(p.slug)}, ${q(p.sku)}, ${q(p.name)}, ${q(p.brandSlug)}, ${q(p.brand)}, ${q(p.categorySlug)}, ${q(p.subcategorySlug)}, ${q(p.supplier?.id)}, ${q(p.unit)}, ${q(p.packInfo)}, ${p.retailPrice}, ${q(p.wholesalePrice)}, ${q(p.wholesaleMinQty)}, ${q(p.listPrice)}, ${q(p.pixDiscountPct)}, ${arr(p.images)}, ${q(p.rating)}, ${p.reviewCount ?? 0}, ${arr(p.badges)}, ${q(p.shortDescription)}, ${q(p.description)}, ${json(p.specs)}, ${q(p.stockStatus)}, ${arr(p.tags)}, ${q(p.yieldHint)})
on conflict (id) do update set slug = excluded.slug, sku = excluded.sku, name = excluded.name, brand_slug = excluded.brand_slug, brand_name = excluded.brand_name, category_slug = excluded.category_slug, subcategory_slug = excluded.subcategory_slug, supplier_id = excluded.supplier_id, unit = excluded.unit, pack_info = excluded.pack_info, retail_price = excluded.retail_price, wholesale_price = excluded.wholesale_price, wholesale_min_qty = excluded.wholesale_min_qty, list_price = excluded.list_price, pix_discount_pct = excluded.pix_discount_pct, images = excluded.images, rating = excluded.rating, review_count = excluded.review_count, badges = excluded.badges, short_description = excluded.short_description, description = excluded.description, specs = excluded.specs, stock_status = excluded.stock_status, tags = excluded.tags, yield_hint = excluded.yield_hint;`,
  );
}

lines.push("\n-- banners");
mockCatalog.banners.forEach((b, i) => {
  lines.push(
    `insert into public.banners (id, eyebrow, title, subtitle, cta, href, image, theme, variant, sort) values (${q(b.id)}, ${q(b.eyebrow)}, ${q(b.title)}, ${q(b.subtitle)}, ${q(b.cta)}, ${q(b.href)}, ${q(b.image)}, ${q(b.theme)}, ${q(b.variant ?? "photo")}, ${i})
  on conflict (id) do update set eyebrow = excluded.eyebrow, title = excluded.title, subtitle = excluded.subtitle, cta = excluded.cta, href = excluded.href, image = excluded.image, theme = excluded.theme, variant = excluded.variant, sort = excluded.sort;`,
  );
});

lines.push("\ncommit;");

const out = resolve(here, "../supabase/seed.sql");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`seed.sql gerado: ${mockCatalog.products.length} produtos, ${mockCatalog.categories.length} categorias -> ${out}`);
