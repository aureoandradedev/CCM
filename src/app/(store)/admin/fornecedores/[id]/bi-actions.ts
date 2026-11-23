"use server";

import { assertAdmin } from "@/lib/admin/guard";
import { getCatalogItems, type CatalogItem } from "@/lib/admin/supplier-bi-data";

export async function fetchCatalogItemsAction(
  catalogId: string,
): Promise<{ items: CatalogItem[]; error?: string }> {
  try {
    await assertAdmin();
  } catch {
    return { items: [], error: "Sem permissão" };
  }
  const items = await getCatalogItems(catalogId);
  return { items };
}
