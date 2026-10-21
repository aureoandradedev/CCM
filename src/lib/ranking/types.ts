export interface RankableOffer {
  id: string;
  master_product_id: string;
  supplier_id: string;
  cost_centavos: number;
  stock: number | null;
  lead_time_days: number;
  status: string;
}

export type RankFlag =
  | "out_of_stock"
  | "missing_cost"
  | "missing_lead_time"
  | "price_outlier"
  | "low_stock"
  | "ambiguous_rank";

export interface RankedOffer {
  supplier_offer_id: string;
  supplier_id: string;
  position: number;
  score_total: number;
  score_cost: number;
  score_stock: number;
  score_lead_time: number;
  reasons: string[];
  flags: RankFlag[];
}

export interface ProductRanking {
  master_product_id: string;
  recommended_offer_id: string | null;
  ambiguous: boolean;
  offers: RankedOffer[];
}
