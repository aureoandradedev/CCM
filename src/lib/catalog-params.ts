import type { SortOption } from "@/types/catalog";

/**
 * Parâmetros de URL das listagens (categoria, busca, ofertas, atacado).
 * Tudo vive na URL para o cliente poder compartilhar/voltar (Nielsen:
 * controle e liberdade; links profundos).
 */

export const PAGE_SIZE = 24;

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Mais relevantes" },
  { value: "price-asc", label: "Menor preço" },
  { value: "price-desc", label: "Maior preço" },
  { value: "name", label: "Nome (A a Z)" },
  { value: "newest", label: "Novidades" },
];

export const PRICE_RANGES: { label: string; min?: number; max?: number }[] = [
  { label: "Até R$ 50", max: 50 },
  { label: "R$ 50 a R$ 200", min: 50, max: 200 },
  { label: "R$ 200 a R$ 500", min: 200, max: 500 },
  { label: "Acima de R$ 500", min: 500 },
];

export interface CatalogParams {
  q?: string;
  sub?: string;
  marca?: string;
  ordenar: SortOption;
  atacado: boolean;
  ofertas: boolean;
  min?: number;
  max?: number;
  pagina: number;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const isSort = (v: string | undefined): v is SortOption => SORT_OPTIONS.some((o) => o.value === v);

function numberOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseCatalogParams(sp: SearchParamsRecord): CatalogParams {
  const ordenar = first(sp.ordenar);
  const pagina = Number(first(sp.pagina) ?? "1");
  return {
    q: first(sp.q)?.trim() || undefined,
    sub: first(sp.sub) || undefined,
    marca: first(sp.marca) || undefined,
    ordenar: isSort(ordenar) ? ordenar : "relevance",
    atacado: first(sp.atacado) === "1",
    ofertas: first(sp.ofertas) === "1",
    min: numberOrUndefined(first(sp.min)),
    max: numberOrUndefined(first(sp.max)),
    pagina: Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : 1,
  };
}

/** Monta a URL com o patch aplicado. Qualquer mudança de filtro volta para a página 1. */
export function catalogHref(base: string, params: CatalogParams, patch: Partial<CatalogParams> = {}): string {
  const next: CatalogParams = { ...params, ...patch };
  if (!("pagina" in patch)) next.pagina = 1;

  const usp = new URLSearchParams();
  if (next.q) usp.set("q", next.q);
  if (next.sub) usp.set("sub", next.sub);
  if (next.marca) usp.set("marca", next.marca);
  if (next.ordenar && next.ordenar !== "relevance") usp.set("ordenar", next.ordenar);
  if (next.atacado) usp.set("atacado", "1");
  if (next.ofertas) usp.set("ofertas", "1");
  if (next.min !== undefined) usp.set("min", String(next.min));
  if (next.max !== undefined) usp.set("max", String(next.max));
  if (next.pagina > 1) usp.set("pagina", String(next.pagina));

  const s = usp.toString();
  return s ? `${base}?${s}` : base;
}

export function countActiveFilters(p: CatalogParams): number {
  let n = 0;
  if (p.sub) n++;
  if (p.marca) n++;
  if (p.atacado) n++;
  if (p.ofertas) n++;
  if (p.min !== undefined || p.max !== undefined) n++;
  return n;
}
