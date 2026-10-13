/**
 * Mapeamento de colunas da planilha → campos canônicos do CCM.
 *
 * `ColumnMapping` liga cada campo canônico a uma coluna da origem
 * (ex.: CODIGO → sku, DESCRICAO → name, PRECO → price, SALDO → stock).
 *
 * `suggestMapping` é a sugestão automática: casa cabeçalhos com os `aliases` de
 * cada campo (normalizando acento/caixa). É determinística e já funcional — a
 * arquitetura permite evoluí-la depois (ex.: histórico do fornecedor, ML).
 */
import { CANONICAL_FIELDS, type CanonicalFieldDef, type CanonicalProduct } from "./types";

/** campo canônico (key) -> cabeçalho da origem (ou "" = não mapeado). */
export type ColumnMapping = Partial<Record<keyof CanonicalProduct, string>>;

/** Normaliza para comparação: minúsculo, sem acento, só alfanumérico. */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Sugere automaticamente o mapeamento a partir dos cabeçalhos da planilha. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  for (const field of CANONICAL_FIELDS) {
    const aliases = field.aliases.map(normalizeHeader);
    // 1) match exato com algum alias
    let found = normHeaders.find((h) => !used.has(h.raw) && aliases.includes(h.norm));
    // 2) match parcial (cabeçalho contém alias ou vice-versa)
    if (!found) {
      found = normHeaders.find(
        (h) => !used.has(h.raw) && aliases.some((a) => a.length >= 3 && (h.norm.includes(a) || a.includes(h.norm))),
      );
    }
    if (found) {
      mapping[field.key] = found.raw;
      used.add(found.raw);
    }
  }
  return mapping;
}

/** Converte "1.234,56", "1234.56", "R$ 99,90" etc. em número. */
export function parseNumberBR(value: string | undefined | null): number | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, ""); // remove R$, espaços, letras
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // o último separador é o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", "."); // formato BR: 1.234,56
    } else {
      s = s.replace(/,/g, ""); // formato US: 1,234.56
    }
  } else if (hasComma) {
    s = s.replace(",", "."); // 99,90
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Status textual da planilha → status canônico. */
export function parseStatus(value: string | undefined): CanonicalProduct["status"] | undefined {
  if (!value) return undefined;
  const v = normalizeHeader(value);
  if (["ativo", "active", "sim", "s", "1", "true", "disponivel"].includes(v)) return "active";
  if (["inativo", "inactive", "nao", "n", "0", "false", "indisponivel"].includes(v)) return "inactive";
  if (["rascunho", "draft"].includes(v)) return "draft";
  return undefined;
}

/** Divide uma célula de imagens em lista de URLs. */
export function parseImages(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const urls = value
    .split(/[|;,\s]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  return urls.length ? urls : undefined;
}

export function fieldByKey(key: keyof CanonicalProduct): CanonicalFieldDef | undefined {
  return CANONICAL_FIELDS.find((f) => f.key === key);
}
