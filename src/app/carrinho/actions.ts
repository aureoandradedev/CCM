"use server";

import { getProductsByIds } from "@/lib/data/catalog";

export interface CurrentPrice {
  retailPrice: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
}

export async function fetchCurrentPrices(
  productIds: string[],
): Promise<Record<string, CurrentPrice>> {
  if (productIds.length === 0) return {};
  const products = await getProductsByIds(productIds);
  const map: Record<string, CurrentPrice> = {};
  for (const p of products) {
    map[p.id] = {
      retailPrice: p.retailPrice,
      wholesalePrice: p.wholesalePrice,
      wholesaleMinQty: p.wholesaleMinQty,
    };
  }
  return map;
}
