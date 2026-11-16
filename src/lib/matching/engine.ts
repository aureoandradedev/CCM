import type { NormalizedData } from "../normalization/types";
import type {
  MasterProductRow,
  MatchableItem,
  MatchCandidate,
  MatchResult,
  MatchSignal,
} from "./types";
import {
  MATCH_WEIGHTS,
  MATCH_THRESHOLDS,
  ATTRIBUTE_PENALTIES,
  EAN_OVERRIDE_SCORE,
  HARD_CONFLICT_ATTRIBUTES,
  MIN_SCORE_GAP,
  AMBIGUITY_MIN_SCORE,
  STOP_TOKENS,
} from "./config";

// ── Text helpers ───────────────────────────────────────────────────────────

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function toKey(str: string): string {
  return removeAccents(str).trim().toLowerCase().replace(/[\s\-_./]+/g, "").replace(/[^a-z0-9]/g, "");
}

function tokenize(str: string): string[] {
  return removeAccents(str)
    .trim()
    .toLowerCase()
    .split(/[\s/,;]+/)
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

// ── Candidate index ────────────────────────────────────────────────────────

export interface MasterIndex {
  all: MasterProductRow[];
  byId: Map<string, MasterProductRow>;
  byEan: Map<string, MasterProductRow[]>;
  byBrandModel: Map<string, MasterProductRow[]>;
  byBrand: Map<string, MasterProductRow[]>;
  byCategory: Map<string, MasterProductRow[]>;
  byToken: Map<string, Set<number>>;
  tokensByMaster: Map<string, string[]>;
  modelKeyByMaster: Map<string, string>;
}

export function buildMasterIndex(masters: MasterProductRow[]): MasterIndex {
  const byId = new Map<string, MasterProductRow>();
  const byEan = new Map<string, MasterProductRow[]>();
  const byBrandModel = new Map<string, MasterProductRow[]>();
  const byBrand = new Map<string, MasterProductRow[]>();
  const byCategory = new Map<string, MasterProductRow[]>();
  const byToken = new Map<string, Set<number>>();
  const tokensByMaster = new Map<string, string[]>();
  const modelKeyByMaster = new Map<string, string>();

  for (let idx = 0; idx < masters.length; idx++) {
    const m = masters[idx];
    byId.set(m.id, m);

    if (m.ean) {
      const ean = m.ean.replace(/[\s\-./]/g, "");
      if (/^\d+$/.test(ean)) {
        const arr = byEan.get(ean) ?? [];
        arr.push(m);
        byEan.set(ean, arr);
      }
    }

    if (m.brand_slug && m.model) {
      const mk = toKey(m.model);
      if (mk) {
        const bm = `${m.brand_slug}::${mk}`;
        const arr = byBrandModel.get(bm) ?? [];
        arr.push(m);
        byBrandModel.set(bm, arr);
        modelKeyByMaster.set(m.id, mk);
      }
    }

    if (m.brand_slug) {
      const arr = byBrand.get(m.brand_slug) ?? [];
      arr.push(m);
      byBrand.set(m.brand_slug, arr);
    }

    if (m.category_slug) {
      const arr = byCategory.get(m.category_slug) ?? [];
      arr.push(m);
      byCategory.set(m.category_slug, arr);
    }

    const toks = tokenize(m.name);
    tokensByMaster.set(m.id, toks);
    for (const t of toks) {
      let s = byToken.get(t);
      if (!s) { s = new Set(); byToken.set(t, s); }
      s.add(idx);
    }
  }

  return { all: masters, byId, byEan, byBrandModel, byBrand, byCategory, byToken, tokensByMaster, modelKeyByMaster };
}

// ── Candidate generation ───────────────────────────────────────────────────

function gatherCandidates(
  nd: NormalizedData,
  idx: MasterIndex,
): Set<string> {
  const ids = new Set<string>();

  if (nd.ean_clean) {
    const eanMatches = idx.byEan.get(nd.ean_clean);
    if (eanMatches) {
      for (const m of eanMatches) ids.add(m.id);
    }
  }

  if (nd.brand_slug && nd.model_key) {
    const bm = `${nd.brand_slug}::${nd.model_key}`;
    const bmMatches = idx.byBrandModel.get(bm);
    if (bmMatches) {
      for (const m of bmMatches) ids.add(m.id);
    }
  }

  if (nd.brand_slug) {
    const brandMatches = idx.byBrand.get(nd.brand_slug);
    if (brandMatches) {
      for (const m of brandMatches) ids.add(m.id);
    }
  }

  const itemTokens = nd.name_tokens.filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
  if (itemTokens.length > 0) {
    const hitCount = new Map<number, number>();
    for (const t of itemTokens) {
      const masterIdxs = idx.byToken.get(t);
      if (masterIdxs) {
        for (const mi of masterIdxs) {
          hitCount.set(mi, (hitCount.get(mi) ?? 0) + 1);
        }
      }
    }
    for (const [mi, count] of hitCount) {
      if (count >= 2) ids.add(idx.all[mi].id);
    }
  }

  if (nd.category_slug) {
    const catMatches = idx.byCategory.get(nd.category_slug);
    if (catMatches) {
      for (const m of catMatches) ids.add(m.id);
    }
  }

  return ids;
}

// ── Attribute helpers ──────────────────────────────────────────────────────

function extractMasterAttrs(m: MasterProductRow): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (Array.isArray(m.specs)) {
    for (const s of m.specs as Array<{ key?: string; value?: string | number }>) {
      if (s.key && s.value != null) attrs[s.key] = s.value;
    }
  } else if (typeof m.specs === "object" && m.specs) {
    Object.assign(attrs, m.specs);
  }
  return attrs;
}

function detectHardConflicts(
  itemAttrs: Record<string, string | number>,
  masterAttrs: Record<string, string | number>,
): MatchSignal[] {
  const conflicts: MatchSignal[] = [];

  for (const attr of HARD_CONFLICT_ATTRIBUTES) {
    const itemVal = itemAttrs[attr];
    const masterVal = masterAttrs[attr];
    if (itemVal != null && masterVal != null && String(itemVal) !== String(masterVal)) {
      conflicts.push({
        signal: `hard_conflict_${attr}`,
        weight: 0,
        matched: false,
        detail: `${itemVal} vs ${masterVal}`,
      });
    }
  }

  return conflicts;
}

function appendAttributeSignals(
  itemAttrs: Record<string, string | number>,
  masterAttrs: Record<string, string | number>,
  signals: MatchSignal[],
): void {
  const iv = itemAttrs.voltage, mv = masterAttrs.voltage;
  if (iv && mv && String(iv) !== String(mv)) {
    if (!signals.some(s => s.signal === "voltage_mismatch"))
      signals.push({ signal: "voltage_mismatch", weight: 0, matched: false, detail: `${iv} vs ${mv}` });
  }
  const ic = itemAttrs.color, mc = masterAttrs.color;
  if (ic && mc && String(ic) !== String(mc)) {
    signals.push({ signal: "color_mismatch", weight: 0, matched: false, detail: `${ic} vs ${mc}` });
  }
  const im = itemAttrs.measure_cm, mm = masterAttrs.measure_cm;
  if (im && mm && Number(im) !== Number(mm)) {
    signals.push({ signal: "measure_mismatch", weight: 0, matched: false, detail: `${im}cm vs ${mm}cm` });
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────

function scoreCandidate(
  nd: NormalizedData,
  master: MasterProductRow,
  idx: MasterIndex,
): MatchCandidate {
  const signals: MatchSignal[] = [];
  let score = 0;
  const masterAttrs = extractMasterAttrs(master);

  // ── Hard conflict detection (before scoring) ─────────────────────────
  const hardConflicts = detectHardConflicts(nd.attributes, masterAttrs);
  const hasHardConflict = hardConflicts.length > 0;
  signals.push(...hardConflicts);

  // ── EAN ──────────────────────────────────────────────────────────────
  const eanMatch =
    nd.ean_clean != null &&
    master.ean != null &&
    nd.ean_clean === master.ean.replace(/[\s\-./]/g, "");

  const eanMasters = nd.ean_clean ? (idx.byEan.get(nd.ean_clean)?.length ?? 0) : 0;
  const eanDuplicate = eanMasters > 1;
  const eanUnique = eanMatch && !eanDuplicate;

  // EAN válido + único → override determinístico (score 95)
  if (eanUnique && nd.ean_valid) {
    score = EAN_OVERRIDE_SCORE;
    signals.push({ signal: "ean_exact", weight: EAN_OVERRIDE_SCORE, matched: true, detail: "EAN exato válido" });
    appendAttributeSignals(nd.attributes, masterAttrs, signals);
    return { master_product_id: master.id, score: Math.min(100, score), signals, has_hard_conflict: hasHardConflict };
  }

  // EAN check digit inválido + único → override COM guards extras
  if (eanUnique && !nd.ean_valid) {
    const brandOk = nd.brand_slug != null && nd.brand_slug === master.brand_slug;
    const iToks = new Set(nd.name_tokens.filter(t => t.length > 1 && !STOP_TOKENS.has(t)));
    const mToks = new Set(idx.tokensByMaster.get(master.id) ?? []);
    let isect = 0;
    for (const t of iToks) if (mToks.has(t)) isect++;
    const nameCompatible = brandOk || isect >= 2;

    if (!hasHardConflict && nameCompatible) {
      score = EAN_OVERRIDE_SCORE;
      signals.push({ signal: "ean_exact", weight: EAN_OVERRIDE_SCORE, matched: true, detail: "EAN exato com check digit inválido" });
      appendAttributeSignals(nd.attributes, masterAttrs, signals);
      return { master_product_id: master.id, score: Math.min(100, score), signals, has_hard_conflict: hasHardConflict };
    }
    signals.push({
      signal: "ean_exact", weight: 0, matched: false,
      detail: `EAN exato (check digit inválido) — ${hasHardConflict ? "hard conflict" : "nome/marca incompatível"}`,
    });
  } else if (eanMatch && eanDuplicate) {
    signals.push({ signal: "ean_duplicate", weight: 0, matched: false, detail: `${eanMasters} masters com mesmo EAN` });
  } else {
    signals.push({ signal: "ean_exact", weight: 0, matched: false });
  }

  // ── Brand + Model ────────────────────────────────────────────────────
  const masterModelKey = idx.modelKeyByMaster.get(master.id);
  const brandMatch = nd.brand_slug != null && nd.brand_slug === master.brand_slug;
  const modelMatch = nd.model_key != null && masterModelKey != null && nd.model_key === masterModelKey;

  if (brandMatch && modelMatch) {
    score += MATCH_WEIGHTS.BRAND_MODEL;
    signals.push({ signal: "brand_model", weight: MATCH_WEIGHTS.BRAND_MODEL, matched: true });
  } else if (brandMatch) {
    score += Math.round(MATCH_WEIGHTS.BRAND_MODEL * 0.3);
    signals.push({ signal: "brand_only", weight: Math.round(MATCH_WEIGHTS.BRAND_MODEL * 0.3), matched: true, detail: "marca sem modelo" });
  } else {
    signals.push({ signal: "brand_model", weight: 0, matched: false });
  }

  // ── Name tokens (Jaccard) ────────────────────────────────────────────
  const itemTokens = new Set(nd.name_tokens.filter((t) => t.length > 1 && !STOP_TOKENS.has(t)));
  const masterTokens = new Set(idx.tokensByMaster.get(master.id) ?? []);

  let intersection = 0;
  for (const t of itemTokens) {
    if (masterTokens.has(t)) intersection++;
  }
  const union = new Set([...itemTokens, ...masterTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const nameScore = Math.round(jaccard * MATCH_WEIGHTS.NAME_TOKENS);
  score += nameScore;
  signals.push({ signal: "name_tokens", weight: nameScore, matched: jaccard >= 0.3, detail: `jaccard=${jaccard.toFixed(2)}` });

  // ── Category ─────────────────────────────────────────────────────────
  const catMatch = nd.category_slug != null && nd.category_slug === master.category_slug;
  const subMatch = nd.subcategory_slug != null && nd.subcategory_slug === master.subcategory_slug;
  if (catMatch) {
    const catScore = subMatch ? MATCH_WEIGHTS.CATEGORY : Math.round(MATCH_WEIGHTS.CATEGORY * 0.6);
    score += catScore;
    signals.push({ signal: "category", weight: catScore, matched: true, detail: subMatch ? "cat+sub" : "cat only" });
  } else {
    signals.push({ signal: "category", weight: 0, matched: false });
  }

  // ── Attributes (confirmation / penalty) ──────────────────────────────
  let attrBonus = 0;
  let penalty = 0;

  // Voltage
  const itemVoltage = nd.attributes.voltage;
  const masterVoltage = masterAttrs.voltage;
  if (itemVoltage && masterVoltage) {
    if (String(itemVoltage) === String(masterVoltage)) {
      attrBonus += MATCH_WEIGHTS.ATTRIBUTES;
    } else {
      penalty += ATTRIBUTE_PENALTIES.VOLTAGE_MISMATCH;
      signals.push({ signal: "voltage_mismatch", weight: -ATTRIBUTE_PENALTIES.VOLTAGE_MISMATCH, matched: false, detail: `${itemVoltage} vs ${masterVoltage}` });
    }
  }

  // Color (soft penalty only)
  const itemColor = nd.attributes.color;
  const masterColor = masterAttrs.color;
  if (itemColor && masterColor) {
    if (String(itemColor) === String(masterColor)) {
      attrBonus += Math.round(MATCH_WEIGHTS.ATTRIBUTES * 0.5);
    } else {
      penalty += ATTRIBUTE_PENALTIES.COLOR_MISMATCH;
      signals.push({ signal: "color_mismatch", weight: -ATTRIBUTE_PENALTIES.COLOR_MISMATCH, matched: false, detail: `${itemColor} vs ${masterColor}` });
    }
  }

  // Measure (cm)
  const itemMeasure = nd.attributes.measure_cm;
  const masterMeasure = masterAttrs.measure_cm;
  if (itemMeasure && masterMeasure) {
    if (Number(itemMeasure) === Number(masterMeasure)) {
      attrBonus += Math.round(MATCH_WEIGHTS.ATTRIBUTES * 0.5);
    } else {
      penalty += ATTRIBUTE_PENALTIES.MEASURE_MISMATCH;
      signals.push({ signal: "measure_mismatch", weight: -ATTRIBUTE_PENALTIES.MEASURE_MISMATCH, matched: false, detail: `${itemMeasure}cm vs ${masterMeasure}cm` });
    }
  }

  if (attrBonus > 0) {
    const capped = Math.min(attrBonus, MATCH_WEIGHTS.ATTRIBUTES);
    score += capped;
    signals.push({ signal: "attributes_match", weight: capped, matched: true });
  }

  score = Math.max(0, score - penalty);

  return {
    master_product_id: master.id,
    score: Math.min(100, score),
    signals,
    has_hard_conflict: hasHardConflict,
  };
}

// ── Match one item ─────────────────────────────────────────────────────────

export function matchItem(
  item: MatchableItem,
  idx: MasterIndex,
): MatchResult {
  const nd = item.normalized_data;
  const candidateIds = gatherCandidates(nd, idx);

  if (candidateIds.size === 0) {
    return {
      item_id: item.id,
      master_product_id: null,
      match_confidence: 0,
      match_signals: [],
      match_status: "normalizado",
    };
  }

  const candidates: MatchCandidate[] = [];
  for (const id of candidateIds) {
    const master = idx.byId.get(id);
    if (master) candidates.push(scoreCandidate(nd, master, idx));
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return {
      item_id: item.id,
      master_product_id: null,
      match_confidence: 0,
      match_signals: [],
      match_status: "normalizado",
    };
  }

  const best = candidates[0];
  const second = candidates.length > 1 ? candidates[1] : null;
  const ambiguous = second != null && (best.score - second.score) < MIN_SCORE_GAP;

  if (best.score <= 0) {
    return {
      item_id: item.id,
      master_product_id: null,
      match_confidence: 0,
      match_signals: [],
      match_status: "normalizado",
    };
  }

  let status: MatchResult["match_status"];

  if (best.has_hard_conflict) {
    status = "revisao_manual";
    best.signals.push({
      signal: "hard_conflict_override",
      weight: 0,
      matched: false,
      detail: "atributo crítico incompatível impede match_sugerido",
    });
  } else if (best.score >= MATCH_THRESHOLDS.HIGH_CONFIDENCE && !ambiguous) {
    status = "match_sugerido";
  } else if (best.score >= MATCH_THRESHOLDS.REVIEW) {
    status = "revisao_manual";
  } else if (ambiguous && best.score >= AMBIGUITY_MIN_SCORE) {
    status = "revisao_manual";
  } else {
    status = "normalizado";
  }

  if (ambiguous) {
    best.signals.push({
      signal: "ambiguous",
      weight: 0,
      matched: false,
      detail: `gap=${best.score - (second?.score ?? 0)} < ${MIN_SCORE_GAP}`,
    });
  }

  return {
    item_id: item.id,
    master_product_id: best.master_product_id,
    match_confidence: best.score,
    match_signals: best.signals,
    match_status: status,
  };
}

// ── Batch match ────────────────────────────────────────────────────────────

export function matchItems(
  items: MatchableItem[],
  idx: MasterIndex,
): MatchResult[] {
  return items.map((item) => matchItem(item, idx));
}
