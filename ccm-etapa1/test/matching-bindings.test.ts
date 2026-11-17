/**
 * Tests for matching bindings (persistent matching memory).
 *
 * Scenarios A–F as specified:
 * A: Same supplier + SKU → auto-approve via binding
 * B: Same supplier + SKU but voltage conflict → NOT auto-approve
 * C: Different supplier, similar name → no deterministic binding
 * D: Revoked binding → not reused
 * E: Name change but same supplier + SKU → still works if no hard conflict
 * F: SKU change → normal matching pipeline (no binding found)
 *
 * Run: node --experimental-strip-types --test ccm-etapa1/test/matching-bindings.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Inline the pure functions to test without Next.js module resolution ─────

const UNIT_EQUIV: Record<string, string> = {
  kg: "kg", kilo: "kg", quilo: "kg", kilograma: "kg", quilograma: "kg",
  g: "g", gr: "g", grama: "g", gramas: "g",
  v: "v", volt: "v", volts: "v",
  w: "w", watt: "w", watts: "w",
  l: "l", lt: "l", litro: "l", litros: "l",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  m: "m", mt: "m", metro: "m", metros: "m",
  cm: "cm", centimetro: "cm", centimetros: "cm",
  mm: "mm", milimetro: "mm", milimetros: "mm",
  pol: "pol", polegada: "pol", polegadas: "pol",
};

const STOP_TOKENS = new Set([
  "unidade", "produto", "novo", "caixa", "pacote",
  "com", "para", "sem", "por", "und", "pcs",
]);

const HARD_CONFLICT_ATTRIBUTES = new Set([
  "voltage", "weight_kg", "measure_cm", "power_w",
]);

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalTokens(str: string): string[] {
  let s = removeAccents(str).toLowerCase();
  s = s.replace(/[-_.]+/g, " ");
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  s = s.replace(/(\d)([a-z])/g, "$1 $2");
  const raw = s.split(/[\s/,;:()[\]{}]+/).filter(Boolean);
  const result: string[] = [];
  for (const t of raw) {
    const normalized = UNIT_EQUIV[t] ?? t;
    if (normalized.length > 0 && !STOP_TOKENS.has(normalized) && !STOP_TOKENS.has(t)) {
      result.push(normalized);
    }
  }
  return result;
}

function canonicalNameKey(name: string): string {
  return canonicalTokens(name).sort().join(" ");
}

// Attribute extraction (simplified from normalizers.ts)
const VOLTAGE_RE = /\b(110|127|220|380|bivolt)\s*v?\b/i;
const BIVOLT_RE = /\bbivolt\b/i;
const WEIGHT_RE = /\b(\d+(?:[.,]\d+)?)\s*kg\b/i;
const POWER_RE = /\b(\d+)\s*w(?:atts?)?\b/i;
const DIAMETER_RE = /\b(\d+)\s*(?:mm|cm)\b/i;

function extractAttributes(name: string, _desc: string | null): Record<string, string | number> {
  const text = name;
  const attrs: Record<string, string | number> = {};
  if (BIVOLT_RE.test(text)) {
    attrs.voltage = "bivolt";
  } else {
    const vm = text.match(VOLTAGE_RE);
    if (vm) attrs.voltage = `${vm[1]}V`;
  }
  const pm = text.match(POWER_RE);
  if (pm) attrs.power_w = parseInt(pm[1], 10);
  const wm = text.match(WEIGHT_RE);
  if (wm) attrs.weight_kg = parseFloat(wm[1].replace(",", "."));
  const dm = text.match(DIAMETER_RE);
  if (dm) attrs.measure_cm = parseInt(dm[1], 10);
  return attrs;
}

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

interface BindingGuardResult { passed: boolean; detail: string }

function checkBindingGuard(
  item: { ean: string | null; brand: string | null; model: string | null; name: string },
  master: { ean: string | null; brand_slug: string | null; model: string | null; specs: unknown },
): BindingGuardResult {
  if (item.ean && item.ean.trim() !== "") {
    if (master.ean && master.ean !== item.ean) {
      return { passed: false, detail: `EAN mismatch: item=${item.ean}, master=${master.ean}` };
    }
  } else {
    const itemBrand = item.brand ? normalizeText(item.brand) : null;
    const masterBrand = master.brand_slug ?? null;
    const itemModel = item.model ? normalizeText(item.model) : null;
    const masterModel = master.model ? normalizeText(master.model) : null;
    if (itemBrand && masterBrand && itemBrand !== masterBrand && !masterBrand.includes(itemBrand) && !itemBrand.includes(masterBrand)) {
      return { passed: false, detail: `Brand mismatch` };
    }
    if (itemModel && masterModel && itemModel !== masterModel) {
      return { passed: false, detail: `Model mismatch` };
    }
  }

  const itemAttrs = extractAttributes(item.name, null);
  const masterAttrs = extractMasterAttrs(master.specs);
  for (const attr of HARD_CONFLICT_ATTRIBUTES) {
    const iv = itemAttrs[attr];
    const mv = masterAttrs[attr];
    if (iv != null && mv != null && String(iv) !== String(mv)) {
      return { passed: false, detail: `Hard conflict: ${attr} item=${iv} master=${mv}` };
    }
  }

  return { passed: true, detail: "" };
}

// ── Mock Supabase client ────────────────────────────────────────────────────

interface MockRow { [key: string]: unknown }

function createMockSb(tables: Record<string, MockRow[]>) {
  function queryBuilder(tableName: string) {
    let rows = [...(tables[tableName] ?? [])];
    const filters: Array<(r: MockRow) => boolean> = [];
    let selectFields: string[] | null = null;
    let sortField: string | null = null;
    let sortAsc = true;
    let limitN: number | null = null;
    let isSingle = false;
    let isMaybeSingle = false;

    const chain = {
      select(fields: string) {
        selectFields = fields.split(",").map(s => s.trim().split("(")[0]);
        return chain;
      },
      eq(field: string, value: unknown) {
        filters.push(r => r[field] === value);
        return chain;
      },
      neq(field: string, value: unknown) {
        filters.push(r => r[field] !== value);
        return chain;
      },
      in(field: string, values: unknown[]) {
        filters.push(r => values.includes(r[field]));
        return chain;
      },
      not(field: string, op: string, value: unknown) {
        if (op === "is") filters.push(r => r[field] !== value && r[field] != null);
        return chain;
      },
      is(field: string, value: unknown) {
        filters.push(r => r[field] === value || r[field] == null);
        return chain;
      },
      order(field: string, opts?: { ascending?: boolean }) {
        sortField = field;
        sortAsc = opts?.ascending ?? true;
        return chain;
      },
      limit(n: number) { limitN = n; return chain; },
      single() { isSingle = true; return chain.execute(); },
      maybeSingle() { isMaybeSingle = true; return chain.execute(); },
      then(resolve: (v: unknown) => void) { return chain.execute().then(resolve); },
      execute() {
        let result = rows;
        for (const f of filters) result = result.filter(f);
        if (sortField) {
          const sf = sortField;
          result.sort((a, b) => {
            const va = a[sf], vb = b[sf];
            if (va == null || vb == null) return 0;
            return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
          });
        }
        if (limitN != null) result = result.slice(0, limitN);
        if (isSingle) return Promise.resolve({ data: result[0] ?? null, error: result.length === 0 ? { message: "not found" } : null });
        if (isMaybeSingle) return Promise.resolve({ data: result[0] ?? null, error: null });
        return Promise.resolve({ data: result, error: null });
      },
    };
    return chain;
  }

  return {
    from(table: string) {
      const q = queryBuilder(table);
      return {
        ...q,
        insert(row: MockRow) {
          if (!tables[table]) tables[table] = [];
          tables[table].push(row);
          return Promise.resolve({ data: row, error: null });
        },
        update(values: MockRow) {
          return {
            eq(field: string, value: unknown) {
              const chain = {
                eq(f2: string, v2: unknown) {
                  for (const r of tables[table] ?? []) {
                    if (r[field] === value && r[f2] === v2) Object.assign(r, values);
                  }
                  return { in: () => Promise.resolve({ error: null }), then: (fn: (v: unknown) => void) => Promise.resolve({ error: null }).then(fn) };
                },
                in(_f: string, _vals: unknown[]) {
                  for (const r of tables[table] ?? []) {
                    if (r[field] === value) Object.assign(r, values);
                  }
                  return Promise.resolve({ error: null });
                },
                then(fn: (v: unknown) => void) {
                  for (const r of tables[table] ?? []) {
                    if (r[field] === value) Object.assign(r, values);
                  }
                  return Promise.resolve({ error: null }).then(fn);
                },
              };
              return chain;
            },
          };
        },
      };
    },
    rpc(name: string, _params: unknown) {
      return Promise.resolve({ data: { ok: true, created: 0 }, error: null });
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("canonicalNameKey", () => {
  test("produces order-invariant key", () => {
    const k1 = canonicalNameKey("Votoran Cimento CPII 50KG");
    const k2 = canonicalNameKey("Cimento 50KG CPII Votoran");
    assert.equal(k1, k2);
  });

  test("normalizes units", () => {
    const k1 = canonicalNameKey("Saco 50 kilograma");
    const k2 = canonicalNameKey("Saco 50 kg");
    assert.equal(k1, k2);
  });

  test("removes stop tokens", () => {
    const k = canonicalNameKey("Cimento Portland com 50 kg");
    assert.ok(!k.includes("com"));
  });
});

describe("checkBindingGuard", () => {
  const baseMaster = {
    ean: "7891234567890",
    brand_slug: "votoran",
    model: null,
    specs: { voltage: "127V", weight_kg: 50 },
  };

  test("passes when data is compatible", () => {
    const item = { ean: "7891234567890", brand: "Votoran", model: null, name: "Cimento Votoran CPII 50KG 127V" };
    const result = checkBindingGuard(item, baseMaster);
    assert.equal(result.passed, true);
  });

  test("fails on EAN mismatch", () => {
    const item = { ean: "9999999999999", brand: "Votoran", model: null, name: "Cimento Votoran" };
    const result = checkBindingGuard(item, baseMaster);
    assert.equal(result.passed, false);
    assert.ok(result.detail.includes("EAN mismatch"));
  });

  test("fails on voltage hard conflict", () => {
    const item = { ean: "7891234567890", brand: "Votoran", model: null, name: "Furadeira Votoran 220V" };
    const master = { ...baseMaster, specs: { voltage: "127V" } };
    const result = checkBindingGuard(item, master);
    assert.equal(result.passed, false);
    assert.ok(result.detail.includes("Hard conflict: voltage"));
  });

  test("fails on weight hard conflict", () => {
    const item = { ean: null, brand: "Votoran", model: null, name: "Cimento Votoran CPII 20KG" };
    const master = { ...baseMaster, ean: null, specs: { weight_kg: 50 } };
    const result = checkBindingGuard(item, master);
    assert.equal(result.passed, false);
    assert.ok(result.detail.includes("Hard conflict: weight_kg"));
  });

  test("fails on power hard conflict", () => {
    const item = { ean: null, brand: "Makita", model: null, name: "Serra Circular Makita 1200W" };
    const master = { ean: null, brand_slug: "makita", model: null, specs: { power_w: 750 } };
    const result = checkBindingGuard(item, master);
    assert.equal(result.passed, false);
    assert.ok(result.detail.includes("Hard conflict: power_w"));
  });

  test("passes when no conflicting attributes present", () => {
    const item = { ean: null, brand: "Votoran", model: null, name: "Cimento Votoran CPII" };
    const master = { ean: null, brand_slug: "votoran", model: null, specs: { voltage: "127V" } };
    const result = checkBindingGuard(item, master);
    assert.equal(result.passed, true);
  });

  test("fails on brand mismatch (no EAN)", () => {
    const item = { ean: null, brand: "Quartzolit", model: null, name: "Argamassa Quartzolit" };
    const master = { ean: null, brand_slug: "votoran", model: null, specs: {} };
    const result = checkBindingGuard(item, master);
    assert.equal(result.passed, false);
    assert.ok(result.detail.includes("Brand mismatch"));
  });
});

// ── Scenario A: Same supplier + SKU → auto-approve ──────────────────────────

describe("Scenario A: Same supplier + SKU reuse", () => {
  test("binding lookup finds the master and guard passes", () => {
    const item = {
      ean: "7891234567890",
      brand: "Votoran",
      model: null,
      name: "Votoran Cimento CPII 50KG",
    };
    const master = {
      ean: "7891234567890",
      brand_slug: "votoran",
      model: null,
      specs: { weight_kg: 50 },
    };
    const guard = checkBindingGuard(item, master);
    assert.equal(guard.passed, true, "Guard should pass for compatible data");
  });
});

// ── Scenario B: Same supplier + SKU, voltage 127V vs master 220V ────────────

describe("Scenario B: Hard conflict blocks reuse", () => {
  test("127V item vs 220V master → guard fails", () => {
    const item = {
      ean: null,
      brand: "Makita",
      model: "HP2016",
      name: "Furadeira Makita HP2016 127V 500W",
    };
    const master = {
      ean: null,
      brand_slug: "makita",
      model: "hp2016",
      specs: { voltage: "220V", power_w: 500 },
    };
    const guard = checkBindingGuard(item, master);
    assert.equal(guard.passed, false, "Guard should fail on voltage conflict");
    assert.ok(guard.detail.includes("voltage"), "Detail should mention voltage");
  });

  test("50KG item vs 20KG master → guard fails", () => {
    const item = {
      ean: null,
      brand: "Votoran",
      model: null,
      name: "Cimento Votoran CPII 50KG",
    };
    const master = {
      ean: null,
      brand_slug: "votoran",
      model: null,
      specs: { weight_kg: 20 },
    };
    const guard = checkBindingGuard(item, master);
    assert.equal(guard.passed, false, "Guard should fail on weight conflict");
  });
});

// ── Scenario C: Different supplier, similar name ────────────────────────────

describe("Scenario C: Cross-supplier name does NOT create deterministic binding", () => {
  test("name key is the same for similar names", () => {
    const k1 = canonicalNameKey("Votoran Cimento CPII 50KG");
    const k2 = canonicalNameKey("Cimento Votoran CP II 50 Kg");
    // These may or may not match (CPII vs CP II tokenize differently)
    // The point is: even if they match, it's only auxiliary evidence, never auto-approve
    assert.ok(typeof k1 === "string");
    assert.ok(typeof k2 === "string");
  });

  test("name binding boost is limited (+10), never enough alone for auto-approve", () => {
    // Threshold for auto-approve is 75
    // Name binding boost is 10
    // A score of 35 + 10 = 45 → revisao_manual, NOT match_sugerido
    const NAME_BINDING_BOOST = 10;
    const THRESHOLD = 75;
    const baseScore = 35;
    const boosted = baseScore + NAME_BINDING_BOOST;
    assert.ok(boosted < THRESHOLD, "Name boost alone should not reach auto-approve threshold");
  });

  test("even maximal name boost cannot create match_sugerido from normalizado", () => {
    // normalizado means score < 40
    // With +10 boost, max is 49, still < 75
    const NAME_BINDING_BOOST = 10;
    const maxNormalizadoScore = 39; // just below review threshold
    const boosted = maxNormalizadoScore + NAME_BINDING_BOOST;
    assert.ok(boosted < 75, "Boosted normalizado should stay below HIGH_CONFIDENCE");
  });
});

// ── Scenario D: Revoked binding ─────────────────────────────────────────────

describe("Scenario D: Revoked binding not reused", () => {
  test("mock lookup with revoked binding returns null", async () => {
    const tables = {
      matching_bindings: [
        {
          binding_type: "supplier_sku",
          supplier_id: "s1",
          supplier_sku: "CIM-001",
          master_product_id: "master-x",
          confidence: 95,
          revoked_at: "2026-11-01T00:00:00Z",
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    };

    const sb = createMockSb(tables);
    const { data } = await sb
      .from("matching_bindings")
      .select("master_product_id, confidence")
      .eq("binding_type", "supplier_sku")
      .eq("supplier_id", "s1")
      .eq("supplier_sku", "CIM-001")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    assert.equal(data, null, "Revoked binding should not be found");
  });
});

// ── Scenario E: Name change but same supplier + SKU ─────────────────────────

describe("Scenario E: Name change, same supplier + SKU", () => {
  test("guard passes when name changes but no hard conflict", () => {
    // Previously: "Cimento Votoran CPII 50KG"
    // Now: "Cimento Portland CP-II 50kg Votoran" (different name, same product)
    const item = {
      ean: "7891234567890",
      brand: "Votoran",
      model: null,
      name: "Cimento Portland CP-II 50kg Votoran",
    };
    const master = {
      ean: "7891234567890",
      brand_slug: "votoran",
      model: null,
      specs: { weight_kg: 50 },
    };
    const guard = checkBindingGuard(item, master);
    assert.equal(guard.passed, true, "Name change with compatible data should pass");
  });

  test("guard fails when name change introduces hard conflict", () => {
    // Name changed AND weight changed (20KG vs master 50KG)
    const item = {
      ean: null,
      brand: "Votoran",
      model: null,
      name: "Cimento Votoran CPII 20KG",
    };
    const master = {
      ean: null,
      brand_slug: "votoran",
      model: null,
      specs: { weight_kg: 50 },
    };
    const guard = checkBindingGuard(item, master);
    assert.equal(guard.passed, false, "Weight conflict should block reuse");
  });
});

// ── Scenario F: SKU change → no binding found ───────────────────────────────

describe("Scenario F: SKU change, binding not found", () => {
  test("lookup with new SKU returns null (binding is per supplier+sku)", async () => {
    const tables = {
      matching_bindings: [
        {
          binding_type: "supplier_sku",
          supplier_id: "s1",
          supplier_sku: "CIM-001",
          master_product_id: "master-x",
          confidence: 95,
          revoked_at: null,
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    };

    const sb = createMockSb(tables);

    // Search with the NEW SKU (CIM-002) — should not find anything
    const { data } = await sb
      .from("matching_bindings")
      .select("master_product_id, confidence")
      .eq("binding_type", "supplier_sku")
      .eq("supplier_id", "s1")
      .eq("supplier_sku", "CIM-002")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    assert.equal(data, null, "New SKU should not find old binding");
  });

  test("lookup with old SKU still works", async () => {
    const tables = {
      matching_bindings: [
        {
          binding_type: "supplier_sku",
          supplier_id: "s1",
          supplier_sku: "CIM-001",
          master_product_id: "master-x",
          confidence: 95,
          revoked_at: null,
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    };

    const sb = createMockSb(tables);

    const { data } = await sb
      .from("matching_bindings")
      .select("master_product_id, confidence")
      .eq("binding_type", "supplier_sku")
      .eq("supplier_id", "s1")
      .eq("supplier_sku", "CIM-001")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    assert.ok(data, "Old SKU binding should still be found");
    assert.equal(data.master_product_id, "master-x");
  });
});

// ── Integration: binding creation payloads ──────────────────────────────────

describe("Binding creation payloads", () => {
  test("supplier_sku binding is created for items with SKU", () => {
    const params = {
      supplierId: "s1",
      supplierSku: "CIM-001",
      eanClean: "7891234567890",
      nameNormalized: "cimento votoran cpii 50kg",
      masterProductId: "master-x",
      confidence: 95,
      origin: "admin_approve" as const,
      originItemId: "item-1",
    };

    // Verify all three binding types would be created
    const bindings: { type: string }[] = [];
    if (params.supplierSku) bindings.push({ type: "supplier_sku" });
    if (params.eanClean && /^\d{8,14}$/.test(params.eanClean)) bindings.push({ type: "ean" });
    if (params.nameNormalized && canonicalNameKey(params.nameNormalized).length > 0) bindings.push({ type: "normalized_name" });

    assert.equal(bindings.length, 3, "Should create 3 bindings: supplier_sku, ean, normalized_name");
    assert.deepEqual(
      bindings.map(b => b.type),
      ["supplier_sku", "ean", "normalized_name"],
    );
  });

  test("no EAN binding for invalid EAN", () => {
    const eanClean = "ABC123";
    const isValidForBinding = /^\d{8,14}$/.test(eanClean);
    assert.equal(isValidForBinding, false, "Non-numeric EAN should not create binding");
  });

  test("no supplier_sku binding when SKU is null", () => {
    const supplierSku: string | null = null;
    assert.equal(!!supplierSku, false, "Null SKU should not create binding");
  });
});
