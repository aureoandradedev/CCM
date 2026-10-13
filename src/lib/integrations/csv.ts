/**
 * Parser de CSV/TSV em TypeScript puro (sem dependências novas).
 *
 * Trata o que uma planilha de fornecedor brasileira costuma ter:
 * - delimitador `;` (padrão do Excel pt-BR), `,`, tab ou `|` — detectado sozinho;
 * - campos entre aspas com delimitador/quebra de linha dentro;
 * - aspas escapadas ("");
 * - BOM do Excel e quebras \r\n.
 *
 * .xlsx (binário) NÃO é lido aqui — exigiria uma lib. O fornecedor exporta como
 * CSV (o próprio Excel faz "Salvar como > CSV"). A UI orienta isso.
 */

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  rowCount: number;
}

const DELIMITERS = [";", ",", "\t", "|"];

/** Detecta o delimitador pela 1ª linha (o que aparece mais vezes fora de aspas). */
function detectDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Quebra o texto completo em registros de campos, respeitando aspas. */
function tokenize(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (ch === "\r") {
      // ignora; \r\n cai no \n
    } else {
      field += ch;
    }
  }
  // último campo/registro
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseDelimited(input: string): ParsedTable {
  const text = input.replace(/^﻿/, ""); // remove BOM
  if (!text.trim()) {
    return { headers: [], rows: [], delimiter: ",", rowCount: 0 };
  }
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delimiter = detectDelimiter(firstLine);
  const records = tokenize(text, delimiter).filter((r) => r.some((c) => c.trim() !== ""));
  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, rowCount: 0 };
  }

  const headers = records[0].map((h, idx) => {
    const clean = h.trim();
    return clean || `coluna_${idx + 1}`;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows, delimiter, rowCount: rows.length };
}

/** Lê um File (input type=file) como texto, tolerando acentos latin-1/utf-8. */
export async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  // Tenta UTF-8; se vier com o caractere de substituição (ï¿½), cai para latin-1
  // (planilhas antigas do Excel pt-BR costumam ser Windows-1252).
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}
