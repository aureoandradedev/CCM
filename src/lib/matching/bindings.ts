import { extractAttributes } from "@/lib/normalization/normalizers";
import { HARD_CONFLICT_ATTRIBUTES } from "./config";
import { canonicalTokens } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ── Canonical name key ───────────────────────────────────────────────────────

export function canonicalNameKey(name: string): string {
  const tokens = canonicalTokens(name);
  return tokens.sort().join(" ");
}

// ── Master attrs helper ──────────────────────────────────────────────────────

function extractMasterAttrs(specs: unknown): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (Array.isArray(specs)) {
    for (const s of specs as Array<{ key?: string; value?: string | number }>) {
      if (s.key && s.value != null) attrs[s.key] = s.value;
    }
  } else if (typeof specs === "object" && specs) {
    Object.assign(attrs, specs as Record<string, string | number>);
  }
  return attrs;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Guard: check if reuse is safe ────────────────────────────────────────────

export interface BindingGuardResult {
  passed: boolean;
  detail: string;
}

export function checkBindingGuard(
  item: { ean: string | null; brand: string | null; model: string | null; name: string },
  master: { ean: string | null; brand_slug: string | null; model: string | null; specs: unknown },
): BindingGuardResult {
  // 1. EAN guard
  if (item.ean && item.ean.trim() !== "") {
    if (master.ean && master.ean !== item.ean) {
      return { passed: false, detail: `EAN mismatch: item=${item.ean}, master=${master.ean}` };
    }
  } else {
    // 2. Brand/model guard (only when no EAN to compare)
    const itemBrand = item.brand ? normalizeText(item.brand) : null;
    const masterBrand = master.brand_slug ?? null;
    const itemModel = item.model ? normalizeText(item.model) : null;
    const masterModel = master.model ? normalizeText(master.model) : null;

    if (
      itemBrand && masterBrand &&
      itemBrand !== masterBrand &&
      !masterBrand.includes(itemBrand) &&
      !itemBrand.includes(masterBrand)
    ) {
      return { passed: false, detail: `Brand mismatch: item=${itemBrand}, master=${masterBrand}` };
    }
    if (itemModel && masterModel && itemModel !== masterModel) {
      return { passed: false, detail: `Model mismatch: item=${itemModel}, master=${masterModel}` };
    }
  }

  // 3. Hard conflict attributes (voltage, weight_kg, measure_cm, power_w)
  const itemAttrs = extractAttributes(item.name, null);
  const masterAttrs = extractMasterAttrs(master.specs);

  for (const attr of HARD_CONFLICT_ATTRIBUTES) {
    const itemVal = itemAttrs[attr];
    const masterVal = masterAttrs[attr];
    if (itemVal != null && masterVal != null && String(itemVal) !== String(masterVal)) {
      return { passed: false, detail: `Hard conflict: ${attr} item=${itemVal} master=${masterVal}` };
    }
  }

  return { passed: true, detail: "" };
}

// ── Record bindings after human approval ─────────────────────────────────────

interface BindingPayload {
  binding_type: string;
  master_product_id: string;
  supplier_id?: string | null;
  supplier_sku?: string | null;
  ean_clean?: string | null;
  normalized_name?: string | null;
  confidence?: number | null;
  origin: string;
  origin_item_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordApprovalBindings(
  sb: SupabaseClient,
  params: {
    supplierId: string;
    supplierSku: string | null;
    eanClean: string | null;
    nameNormalized: string | null;
    masterProductId: string;
    confidence: number;
    origin: "admin_approve" | "admin_create" | "admin_associate";
    originItemId: string;
  },
): Promise<{ ok: boolean; created: number }> {
  const bindings: BindingPayload[] = [];

  if (params.supplierSku) {
    bindings.push({
      binding_type: "supplier_sku",
      master_product_id: params.masterProductId,
      supplier_id: params.supplierId,
      supplier_sku: params.supplierSku,
      confidence: params.confidence,
      origin: params.origin,
      origin_item_id: params.originItemId,
    });
  }

  if (params.eanClean && /^\d{8,14}$/.test(params.eanClean)) {
    bindings.push({
      binding_type: "ean",
      master_product_id: params.masterProductId,
      ean_clean: params.eanClean,
      confidence: params.confidence,
      origin: params.origin,
      origin_item_id: params.originItemId,
    });
  }

  if (params.nameNormalized) {
    const nameKey = canonicalNameKey(params.nameNormalized);
    if (nameKey.length > 0) {
      bindings.push({
        binding_type: "normalized_name",
        master_product_id: params.masterProductId,
        supplier_id: params.supplierId,
        normalized_name: nameKey,
        confidence: params.confidence,
        origin: params.origin,
        origin_item_id: params.originItemId,
      });
    }
  }

  if (bindings.length === 0) return { ok: true, created: 0 };

  const { data, error } = await sb.rpc("record_matching_bindings", {
    p_bindings: bindings,
  });

  if (error) {
    console.error("[matching-bindings] RPC error:", error.message);
    return { ok: false, created: 0 };
  }

  const result = data as { ok: boolean; created: number };
  return { ok: result.ok, created: result.created };
}

// ── Lookup binding by supplier_sku ───────────────────────────────────────────

export async function lookupSkuBinding(
  sb: SupabaseClient,
  supplierId: string,
  supplierSku: string,
): Promise<{ master_product_id: string; confidence: number | null } | null> {
  const { data } = await sb
    .from("matching_bindings")
    .select("master_product_id, confidence")
    .eq("binding_type", "supplier_sku")
    .eq("supplier_id", supplierId)
    .eq("supplier_sku", supplierSku)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

// ── Lookup name bindings (batch, for scoring boost) ──────────────────────────

export async function lookupNameBindings(
  sb: SupabaseClient,
  nameKeys: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (nameKeys.length === 0) return result;

  const { data } = await sb
    .from("matching_bindings")
    .select("normalized_name, master_product_id")
    .eq("binding_type", "normalized_name")
    .in("normalized_name", nameKeys)
    .is("revoked_at", null);

  for (const b of data ?? []) {
    const key = b.normalized_name as string;
    const set = result.get(key) ?? new Set<string>();
    set.add(b.master_product_id as string);
    result.set(key, set);
  }

  return result;
}
