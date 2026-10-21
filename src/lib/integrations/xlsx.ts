/**
 * Parser de Excel (.xlsx) → ParsedTable.
 *
 * Usa ExcelJS via dynamic import para não pesar no bundle inicial.
 * Produz o mesmo formato que `parseDelimited` de csv.ts — o CsvImporter
 * consome qualquer um dos dois sem distinção.
 *
 * .xls (BIFF legado) NÃO é suportado — ExcelJS lê apenas .xlsx.
 * Fórmulas são tratadas como dados (usa o valor calculado, nunca executa).
 */
import type { ParsedTable } from "./csv";

const MAX_ROWS = 10_000;

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString("pt-BR");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;

  const obj = value as Record<string, unknown>;

  // Fórmula: usar resultado calculado, nunca a fórmula em si
  if ("result" in obj && obj.result !== undefined) return cellToString(obj.result);
  // Rich text: concatenar partes
  if ("richText" in obj && Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text: string }>).map((r) => r.text).join("");
  }
  // Hyperlink
  if ("text" in obj && typeof obj.text === "string") return obj.text;
  // Erro de célula
  if ("error" in obj) return "";

  return String(value);
}

export async function parseExcel(file: File): Promise<ParsedTable> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await wb.xlsx.load(buffer);

  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    return { headers: [], rows: [], delimiter: "", rowCount: 0 };
  }

  // Primeira linha = cabeçalhos
  const headerRow = sheet.getRow(1);
  const colCount = headerRow.cellCount;
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    const val = cellToString(headerRow.getCell(c).value).trim();
    headers.push(val || `coluna_${c}`);
  }

  if (headers.length === 0) {
    return { headers: [], rows: [], delimiter: "", rowCount: 0 };
  }

  // Linhas de dados (respeitando MAX_ROWS)
  const rows: Record<string, string>[] = [];
  const lastRow = Math.min(sheet.rowCount, MAX_ROWS + 1);

  for (let r = 2; r <= lastRow; r++) {
    const excelRow = sheet.getRow(r);
    const values: string[] = [];
    let hasContent = false;

    for (let c = 1; c <= headers.length; c++) {
      const val = cellToString(excelRow.getCell(c).value).trim();
      values.push(val);
      if (val) hasContent = true;
    }

    if (!hasContent) continue;

    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] ?? "";
    });
    rows.push(record);
  }

  return { headers, rows, delimiter: "\t", rowCount: rows.length };
}
