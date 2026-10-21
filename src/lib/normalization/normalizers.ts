import type {
  CatalogItemRow,
  NormalizedData,
  ReferenceData,
} from "./types";

// ── Utilitários de texto ────────────────────────────────────────────────────

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(str: string): string {
  return removeAccents(str).trim().replace(/\s+/g, " ").toLowerCase();
}

function slugify(str: string): string {
  return normalizeText(str)
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function tokenize(str: string): string[] {
  return normalizeText(str)
    .split(/[\s/,;]+/)
    .filter((t) => t.length > 0);
}

// ── Nome ────────────────────────────────────────────────────────────────────

export function normalizeName(name: string): {
  normalized: string;
  tokens: string[];
} {
  const normalized = normalizeText(name);
  return { normalized, tokens: tokenize(name) };
}

// ── EAN / GTIN ──────────────────────────────────────────────────────────────

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const GTIN_FORMATS: Record<number, NormalizedData["ean_format"]> = {
  8: "GTIN-8",
  12: "GTIN-12",
  13: "GTIN-13",
  14: "GTIN-14",
};

function validateGTINCheckDigit(digits: string): boolean {
  const n = digits.length;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = parseInt(digits[i], 10);
    if (isNaN(d)) return false;
    sum += d * ((n - 1 - i) % 2 === 1 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(digits[n - 1], 10);
}

export function normalizeEAN(ean: string | null | undefined): {
  clean: string | null;
  valid: boolean;
  format: NormalizedData["ean_format"];
} {
  if (!ean) return { clean: null, valid: false, format: null };

  const clean = ean.replace(/[\s\-./]/g, "");
  if (!/^\d+$/.test(clean))
    return { clean: null, valid: false, format: null };

  if (!GTIN_LENGTHS.has(clean.length))
    return { clean, valid: false, format: null };

  const valid = validateGTINCheckDigit(clean);
  return { clean, valid, format: GTIN_FORMATS[clean.length] ?? null };
}

// ── Unidade ─────────────────────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  un: "UN", und: "UN", unid: "UN", unidade: "UN",
  pc: "UN", pcs: "UN", pç: "UN", peca: "UN", peça: "UN",
  kg: "KG", kilo: "KG", quilo: "KG", kilograma: "KG", quilograma: "KG",
  g: "G", gr: "G", grama: "G", gramas: "G",
  l: "L", lt: "L", litro: "L", litros: "L",
  ml: "ML", mililitro: "ML",
  m: "M", mt: "M", metro: "M", metros: "M",
  m2: "M2", "m²": "M2",
  cx: "CX", caixa: "CX",
  pct: "PCT", pacote: "PCT", pack: "PCT",
  sc: "SC", saco: "SC", sacos: "SC",
  rl: "RL", rolo: "RL",
  fd: "FD", fardo: "FD",
  dz: "DZ", duzia: "DZ",
  par: "PAR", pares: "PAR",
  tb: "TB", tubo: "TB",
  lata: "LATA",
  gl: "GL", galao: "GL", "galão": "GL",
  balde: "BALDE",
  fl: "FL", folha: "FL",
  pt: "PT", pote: "PT",
  br: "BR", barra: "BR",
};

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "UN";
  const key = removeAccents(unit.trim().toLowerCase());
  return UNIT_MAP[key] ?? key.toUpperCase();
}

// ── Marca ───────────────────────────────────────────────────────────────────

export function normalizeBrand(
  brand: string | null | undefined,
  brandsMap: Map<string, string>,
): { slug: string | null; normalized: string; status: "matched" | "unmatched" } {
  if (!brand) return { slug: null, normalized: "", status: "unmatched" };

  const normalized = normalizeText(brand);
  const slug = brandsMap.get(normalized) ?? null;

  if (slug) return { slug, normalized, status: "matched" };

  const asSlug = slugify(brand);
  const slugMatch = brandsMap.get(asSlug) ?? null;
  if (slugMatch) return { slug: slugMatch, normalized, status: "matched" };

  return { slug: null, normalized, status: "unmatched" };
}

// ── Categoria ───────────────────────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, string[]> = {
  "materiais-basicos": [
    "material basico", "materiais basicos", "alvenaria",
    "cimento", "argamassa", "concreto", "tijolo", "bloco",
    "areia", "brita", "aco", "ferro", "ferragem", "impermeabilizante",
  ],
  "pisos-e-revestimentos": [
    "piso", "revestimento", "ceramica", "porcelanato",
    "azulejo", "laminado", "vinilico", "rejunte", "rodape",
  ],
  "tintas-e-acessorios": [
    "tinta", "pintura", "esmalte", "verniz",
    "textura", "selador", "massa corrida", "pincel", "rolo de pintura",
  ],
  "hidraulica": [
    "hidraulica", "hidraulico", "encanamento", "tubo pvc",
    "caixa dagua", "registro", "valvula", "aquecedor",
  ],
  "eletrica": [
    "eletrica", "eletrico", "cabo eletrico",
    "disjuntor", "tomada", "interruptor", "eletroduto",
  ],
  "loucas-e-metais": [
    "louca", "metal sanitario", "torneira",
    "vaso sanitario", "bacia", "cuba", "lavatorio",
    "misturador", "chuveiro", "ducha",
  ],
  "ferramentas": [
    "ferramenta", "furadeira", "parafusadeira",
    "serra", "esmerilhadeira", "epi", "medicao",
  ],
  "telhas-e-coberturas": [
    "telha", "cobertura", "telhado", "fibrocimento",
    "calha", "rufo",
  ],
  "portas-e-janelas": [
    "porta", "janela", "esquadria", "fechadura",
  ],
  "iluminacao": [
    "iluminacao", "lampada", "luminaria", "refletor", "fita led",
  ],
};

export function normalizeCategory(
  categoryOriginal: string | null | undefined,
  subcategoryOriginal: string | null | undefined,
  refs: Pick<ReferenceData, "categories" | "subcategories">,
): {
  categorySlug: string | null;
  subcategorySlug: string | null;
  status: "matched" | "unmatched";
} {
  if (!categoryOriginal && !subcategoryOriginal) {
    return { categorySlug: null, subcategorySlug: null, status: "unmatched" };
  }

  const raw = categoryOriginal ?? "";
  const parts = raw.includes(">")
    ? raw.split(">").map((s) => s.trim())
    : raw.includes("/")
      ? raw.split("/").map((s) => s.trim())
      : [raw.trim()];

  const catPart = normalizeText(parts[0] || "");
  const subPart = parts[1]
    ? normalizeText(parts[1])
    : subcategoryOriginal
      ? normalizeText(subcategoryOriginal)
      : null;

  // 1) Match direto por slug ou nome normalizado
  let categorySlug = refs.categories.get(catPart)
    ?? refs.categories.get(slugify(catPart))
    ?? null;

  // 2) Match por alias
  if (!categorySlug) {
    for (const [slug, aliases] of Object.entries(CATEGORY_ALIASES)) {
      if (aliases.some((a) => catPart.includes(a))) {
        categorySlug = slug;
        break;
      }
    }
  }

  // 3) Se subcategoria não foi encontrada na parte split, tentar match direto no nível sub
  if (!categorySlug && subPart) {
    for (const [slug, aliases] of Object.entries(CATEGORY_ALIASES)) {
      if (aliases.some((a) => subPart.includes(a))) {
        categorySlug = slug;
        break;
      }
    }
  }

  // 4) Match subcategoria dentro da categoria encontrada
  let subcategorySlug: string | null = null;
  if (categorySlug && subPart) {
    const subs = refs.subcategories.get(categorySlug);
    if (subs) {
      const subSlug = slugify(subPart);
      const match = subs.find(
        (s) =>
          s.slug === subSlug ||
          s.normalized.includes(subPart) ||
          subPart.includes(s.normalized),
      );
      if (match) subcategorySlug = match.slug;
    }
  }

  return {
    categorySlug,
    subcategorySlug,
    status: categorySlug ? "matched" : "unmatched",
  };
}

// ── Modelo ──────────────────────────────────────────────────────────────────

export function normalizeModel(
  model: string | null | undefined,
): { key: string | null; original: string | null } {
  if (!model) return { key: null, original: null };

  const key = removeAccents(model.trim())
    .toLowerCase()
    .replace(/[\s\-_./]+/g, "")
    .replace(/[^a-z0-9]/g, "");

  return { key: key || null, original: model.trim() };
}

// ── Embalagem ───────────────────────────────────────────────────────────────

const PACK_PATTERNS = [
  /\b(?:cx|caixa)\s*(?:c\/?|com\s*)?\s*(\d+)\s*(?:un|und|pç|peca|peça|pc)?/i,
  /\b(?:pct|pacote|pack)\s*(?:c\/?|com\s*)?\s*(\d+)\s*(?:un|und|pç|peca|peça|pc)?/i,
  /\b(?:fd|fardo)\s*(?:c\/?|com\s*)?\s*(\d+)/i,
  /\b(\d+)\s*(?:un|und|unid(?:ade)?|pç|peca|peça|pc)\s*(?:\/?\s*(?:cx|caixa|pct|pacote|pack|fd|fardo))/i,
  /\b(\d+)\s*x\s*\d+\s*(?:un|und)/i,
];

const PACK_UNIT_DETECT: [RegExp, string][] = [
  [/\b(?:cx|caixa)\b/i, "CX"],
  [/\b(?:pct|pacote|pack)\b/i, "PCT"],
  [/\b(?:fd|fardo)\b/i, "FD"],
  [/\b(?:dz|duzia)\b/i, "DZ"],
];

export function extractPackaging(
  name: string,
  packInfo: string | null,
): { qty: number | null; unit: string | null } {
  const text = [name, packInfo].filter(Boolean).join(" ");

  for (const pattern of PACK_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const qty = parseInt(m[1], 10);
      if (qty > 0 && qty <= 10_000) {
        let packUnit = "UN";
        for (const [re, u] of PACK_UNIT_DETECT) {
          if (re.test(text)) { packUnit = u; break; }
        }
        return { qty, unit: packUnit };
      }
    }
  }

  return { qty: null, unit: null };
}

// ── Atributos ───────────────────────────────────────────────────────────────

const VOLTAGE_RE = /\b(\d{2,3})\s*v(?:olts?)?\b/i;
const BIVOLT_RE = /\b(?:bi[\s-]?volt|bivolt)\b/i;
const WEIGHT_RE = /\b(\d+(?:[.,]\d+)?)\s*kg\b/i;
const VOLUME_RE = /\b(\d+(?:[.,]\d+)?)\s*(?:l(?:t|itros?)?)\b/i;
const DIAMETER_RE = /\b(\d+)\s*cm\b/i;
const DIMENSIONS_RE =
  /\b(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?))?\s*(?:cm|mm|m)\b/i;

const COLORS: Record<string, string> = {
  preto: "preto", pto: "preto", black: "preto",
  branco: "branco", bco: "branco", white: "branco",
  cinza: "cinza", grafite: "grafite",
  vermelho: "vermelho", red: "vermelho",
  azul: "azul", blue: "azul",
  verde: "verde", green: "verde",
  amarelo: "amarelo",
  marrom: "marrom",
  bege: "bege",
  rosa: "rosa",
  roxo: "roxo",
  laranja: "laranja",
  dourado: "dourado",
  prata: "prata",
  cromado: "cromado",
  inox: "inox",
};

function parseBRNumber(str: string): number {
  return parseFloat(str.replace(",", "."));
}

export function extractAttributes(
  name: string,
  description: string | null,
): Record<string, string | number> {
  const text = [name, description].filter(Boolean).join(" ");
  const attrs: Record<string, string | number> = {};

  // Voltagem
  if (BIVOLT_RE.test(text)) {
    attrs.voltage = "bivolt";
  } else {
    const vm = text.match(VOLTAGE_RE);
    if (vm) attrs.voltage = `${vm[1]}V`;
  }

  // Cor
  const tokens = normalizeText(name).split(/\s+/);
  for (const tok of tokens) {
    if (COLORS[tok]) { attrs.color = COLORS[tok]; break; }
  }

  // Peso
  const wm = text.match(WEIGHT_RE);
  if (wm) attrs.weight_kg = parseBRNumber(wm[1]);

  // Volume
  const volm = text.match(VOLUME_RE);
  if (volm) attrs.volume_l = parseBRNumber(volm[1]);

  // Dimensões
  const dm = text.match(DIMENSIONS_RE);
  if (dm) {
    attrs.dimensions = dm[0];
  } else {
    const diam = text.match(DIAMETER_RE);
    if (diam) attrs.measure_cm = parseInt(diam[1], 10);
  }

  return attrs;
}

// ── Orquestrador ────────────────────────────────────────────────────────────

export function normalizeItem(
  item: CatalogItemRow,
  refs: ReferenceData,
): NormalizedData {
  const nameResult = normalizeName(item.name);
  const eanResult = normalizeEAN(item.ean);
  const unitResult = normalizeUnit(item.unit);
  const brandResult = normalizeBrand(item.brand, refs.brands);
  const catResult = normalizeCategory(
    item.category_original,
    item.subcategory_original,
    refs,
  );
  const modelResult = normalizeModel(item.model);
  const packResult = extractPackaging(item.name, item.pack_info);
  const attrs = extractAttributes(item.name, item.description);

  return {
    name_normalized: nameResult.normalized,
    name_tokens: nameResult.tokens,
    brand_slug: brandResult.slug,
    brand_normalized: brandResult.normalized,
    brand_status: brandResult.status,
    model_key: modelResult.key,
    model_original: modelResult.original,
    ean_clean: eanResult.clean,
    ean_valid: eanResult.valid,
    ean_format: eanResult.format,
    unit_normalized: unitResult,
    category_slug: catResult.categorySlug,
    subcategory_slug: catResult.subcategorySlug,
    category_status: catResult.status,
    pack_qty: packResult.qty,
    pack_unit: packResult.unit,
    attributes: attrs,
  };
}

export function normalizeItems(
  items: CatalogItemRow[],
  refs: ReferenceData,
): Array<{ id: string; normalizedData: NormalizedData; matchStatus: string }> {
  return items.map((item) => ({
    id: item.id,
    normalizedData: normalizeItem(item, refs),
    matchStatus: "normalizado",
  }));
}
