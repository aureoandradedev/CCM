"use server";

import type { NormalizedData } from "@/lib/normalization/types";
import type { MatchSignal } from "@/lib/matching/types";

// ── Tipos de resultado (preservados para evitar quebra de imports) ────

export interface PipelineItemResult {
  item_id: string;
  name: string;
  supplier_sku: string | null;
  cost_centavos: number | null;
  lead_time_days: number | null;
  stock: number | null;
  normalized_data: NormalizedData | null;
  match_status: string;
  match_confidence: number | null;
  master_product_id: string | null;
  master_product_name: string | null;
  match_signals: MatchSignal[] | null;
  offer_action: string | null;
  offer_error: string | null;
}

export interface PipelineCounts {
  total: number;
  normalized: number;
  match_sugerido: number;
  revisao_manual: number;
  sem_match: number;
  auto_approved: number;
  offers_created: number;
  offers_versioned: number;
  offers_skipped: number;
  offers_errors: number;
  ranking_products: number;
  errors: number;
}

export interface PipelineResult {
  ok: boolean;
  error?: string;
  catalogId: string;
  counts: PipelineCounts;
  items: PipelineItemResult[];
}

// ════════════════════════════════════════════════════════════════════════
// DESATIVADO — pipeline do fornecedor não opera mais diretamente.
// A importação e processamento são feitos pelo admin.
// ════════════════════════════════════════════════════════════════════════

function emptyCounts(): PipelineCounts {
  return {
    total: 0,
    normalized: 0,
    match_sugerido: 0,
    revisao_manual: 0,
    sem_match: 0,
    auto_approved: 0,
    offers_created: 0,
    offers_versioned: 0,
    offers_skipped: 0,
    offers_errors: 0,
    ranking_products: 0,
    errors: 0,
  };
}

/** @deprecated Pipeline do fornecedor desativado. */
export async function syncCatalogPipeline(_catalogId: string): Promise<PipelineResult> {
  return { ok: false, error: "Pipeline desativado.", catalogId: _catalogId, counts: emptyCounts(), items: [] };
}

/** @deprecated Pipeline do fornecedor desativado. */
export async function resyncCatalog(): Promise<PipelineResult> {
  return { ok: false, error: "Pipeline desativado.", catalogId: "", counts: emptyCounts(), items: [] };
}
