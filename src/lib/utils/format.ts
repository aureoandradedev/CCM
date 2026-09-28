/** Formatação de dinheiro e números no padrão brasileiro. */

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatBRL(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0,00";
  return brl.format(value);
}

/** Quebra o preço em partes para tipografia: R$ | 1.234 | ,56 */
export function splitBRL(value: number): { symbol: string; int: string; cents: string } {
  const safe = Number.isFinite(value) ? value : 0;
  const [int, cents] = (Math.round(safe * 100) / 100).toFixed(2).split(".");
  return { symbol: "R$", int: Number(int).toLocaleString("pt-BR"), cents };
}

export function formatNumber(value: number): string {
  return num.format(value);
}

const UNIT_LABELS: Record<string, string> = {
  un: "un",
  m2: "m²",
  "m²": "m²",
  m3: "m³",
  "m³": "m³",
  m: "m",
  saco: "saco",
  lata: "lata",
  cx: "cx",
  kg: "kg",
  pc: "pç",
  galao: "galão",
  balde: "balde",
  rolo: "rolo",
  barra: "barra",
  kit: "kit",
  milheiro: "milheiro",
};

export function formatUnit(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

export function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function slugify(input: string): string {
  return String(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
