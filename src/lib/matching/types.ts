import type { NormalizedData } from "../normalization/types";

/** Master product row as loaded for matching. */
export interface MasterProductRow {
  id: string;
  ean: string | null;
  name: string;
  brand_slug: string | null;
  model: string | null;
  category_slug: string | null;
  subcategory_slug: string | null;
  unit: string;
  pack_info: string | null;
  specs: Record<string, unknown>;
}

/** Normalized catalog item ready for matching. */
export interface MatchableItem {
  id: string;
  catalog_id: string;
  normalized_data: NormalizedData;
}

/** Individual signal contributing to a match score. */
export interface MatchSignal {
  signal: string;
  weight: number;
  matched: boolean;
  detail?: string;
}

/** A candidate match between an item and a master product. */
export interface MatchCandidate {
  master_product_id: string;
  score: number;
  signals: MatchSignal[];
  has_hard_conflict: boolean;
}

/** Final match result for one catalog item. */
export interface MatchResult {
  item_id: string;
  master_product_id: string | null;
  match_confidence: number;
  match_signals: MatchSignal[];
  match_status: "match_sugerido" | "revisao_manual" | "normalizado";
}
