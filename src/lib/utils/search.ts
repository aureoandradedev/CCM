/**
 * Motor de busca do catálogo, porte do `busca-mrcd` do Multigiro para TS.
 *
 * Resolve os três problemas clássicos do `includes()`:
 *  1) acento ("argamassa" x "ARGAMASSA", "cerâmica" x "ceramica")
 *  2) multi-palavra ("piso 60x60" acha "PISO PORCELANATO 60X60")
 *  3) ranking (casar palavra inteira no começo do nome vale mais)
 *
 * Também aceita erro de digitação leve (distância 1 a 2), plural e sinônimos
 * do jeito que o cliente da obra fala.
 */

export function normalize(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(s: unknown): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

/** Radical conservador só para plural do português. */
function stem(t: string): string {
  if (t.length > 4 && /(oes|aes|ais|eis|ois)$/.test(t)) return t.slice(0, -3) + "ao";
  if (t.length > 3 && /ns$/.test(t)) return t.slice(0, -2) + "m";
  if (t.length > 3 && /s$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Como o cliente fala x como o fornecedor cadastra. */
const SYNONYMS: Record<string, string[]> = {
  massa: ["argamassa", "massa corrida"],
  reboco: ["argamassa", "massa"],
  cimento: ["cimento", "cp ii"],
  ceramica: ["ceramica", "revestimento", "piso"],
  azulejo: ["revestimento", "ceramica"],
  porcelanato: ["porcelanato", "piso"],
  tinta: ["tinta", "latex", "acrilica"],
  latex: ["tinta", "latex"],
  fio: ["cabo", "fio"],
  cabo: ["cabo", "fio"],
  cano: ["tubo", "cano"],
  tubo: ["tubo", "cano"],
  vaso: ["bacia", "vaso sanitario"],
  privada: ["bacia", "vaso sanitario"],
  pia: ["cuba", "lavatorio"],
  torneira: ["torneira", "misturador"],
  furadeira: ["furadeira", "parafusadeira"],
  lampada: ["lampada", "led"],
  tijolo: ["tijolo", "bloco"],
  bloco: ["bloco", "tijolo"],
  porta: ["porta", "kit porta"],
  caixa: ["caixa d agua", "caixa"],
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

export interface Searchable {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  tags?: string[];
  sku?: string;
}

/**
 * Pontua um item contra a query. 0 = não casa.
 * Cada termo da query precisa casar em algum campo (E lógico).
 */
export function scoreItem(item: Searchable, query: string): number {
  const terms = tokenize(query).map(stem);
  if (!terms.length) return 0;

  const name = normalize(item.name);
  const nameTokens = name.split(" ").map(stem);
  const brand = normalize(item.brand);
  const category = normalize(item.category);
  const tags = (item.tags ?? []).map(normalize).join(" ");
  const sku = normalize(item.sku);
  const haystack = `${name} ${brand} ${category} ${tags} ${sku}`;

  let score = 0;
  for (const term of terms) {
    let best = 0;

    if (nameTokens[0] === term) best = 10;
    else if (nameTokens.includes(term)) best = 7;
    else if (name.includes(term)) best = 5;
    else if (sku === term) best = 9;
    else if (brand.includes(term)) best = 4;
    else if (category.includes(term) || tags.includes(term)) best = 3;
    else {
      const syn = SYNONYMS[term];
      if (syn && syn.some((s) => haystack.includes(normalize(s)))) best = 3;
      else if (term.length >= 4) {
        const tol = term.length >= 7 ? 2 : 1;
        if (
          nameTokens.some(
            (t) => Math.abs(t.length - term.length) <= tol && levenshtein(t, term) <= tol,
          )
        )
          best = 2;
      }
    }

    if (!best) return 0;
    score += best;
  }
  return score;
}

export function searchItems<T extends Searchable>(items: T[], query: string, limit = 60): T[] {
  const q = normalize(query);
  if (!q) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
