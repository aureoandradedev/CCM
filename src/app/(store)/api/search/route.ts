import { NextResponse } from "next/server";

import { getSearchSuggestions } from "@/lib/data/catalog";

/** Sugestões do autocomplete da busca. GET /api/search?q=cimento */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ products: [], categories: [] });
  }

  const { products, categories } = await getSearchSuggestions(q, 6);

  return NextResponse.json(
    {
      products: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        image: p.images[0] ?? "",
        retailPrice: p.retailPrice,
        unit: p.unit,
      })),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
    },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
