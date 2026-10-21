"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, UploadCloud, X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseDelimited, readFileAsText, type ParsedTable } from "@/lib/integrations/csv";
import { suggestMapping, type ColumnMapping } from "@/lib/integrations/mapping";
import { buildSummary } from "@/lib/integrations/validate";
import { CANONICAL_FIELDS } from "@/lib/integrations/types";
import type { ImportSummary } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

export interface CsvResult {
  summary: ImportSummary;
  mapping: ColumnMapping;
  sourceName: string;
  sourceType: "csv" | "xlsx";
}

const NONE = "__none__";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const EXCEL_EXTS = new Set(["xlsx"]);

function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function CsvImporter({ onChange }: { onChange: (result: CsvResult | null) => void }) {
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileName, setFileName] = useState("");
  const [sourceType, setSourceType] = useState<"csv" | "xlsx">("csv");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    if (!table || table.rows.length === 0) return null;
    return buildSummary(table.rows, mapping);
  }, [table, mapping]);

  useEffect(() => {
    if (table && summary) onChange({ summary, mapping, sourceName: fileName, sourceType });
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, summary, mapping, fileName, sourceType]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (file.size > MAX_FILE_SIZE) {
      setError(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). O limite é 5 MB.`);
      return;
    }
    const ext = fileExt(file.name);
    const isExcel = EXCEL_EXTS.has(ext);
    try {
      let parsed: ParsedTable;
      if (isExcel) {
        const { parseExcel } = await import("@/lib/integrations/xlsx");
        parsed = await parseExcel(file);
      } else {
        const text = await readFileAsText(file);
        parsed = parseDelimited(text);
      }
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError("Não encontramos linhas na planilha. Verifique o arquivo e tente novamente.");
        setTable(null);
        return;
      }
      setTable(parsed);
      setMapping(suggestMapping(parsed.headers));
      setFileName(file.name);
      setSourceType(isExcel ? "xlsx" : "csv");
    } catch {
      setError("Não foi possível ler o arquivo. Verifique o formato e tente novamente.");
      setTable(null);
    }
  }, []);

  function reset() {
    setTable(null);
    setMapping({});
    setFileName("");
    setSourceType("csv");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // ---- Dropzone (sem arquivo ainda) ----
  if (!table) {
    return (
      <div>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
            dragOver ? "border-brand-navy bg-brand-yellow-soft/40" : "border-brand-line bg-brand-bg hover:border-brand-navy/40",
          )}
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-yellow-soft text-brand-navy">
            <UploadCloud className="size-7" strokeWidth={2} />
          </span>
          <span className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
            Arraste sua planilha ou clique para enviar
          </span>
          <span className="text-sm text-brand-ink-soft">
            Aceita <strong>.xlsx</strong> e <strong>.csv</strong> (até 5 MB). Separador por vírgula, ponto e vírgula ou tabulação.
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,text/plain,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
        {error ? <p className="mt-3 text-sm font-medium text-brand-red">{error}</p> : null}
      </div>
    );
  }

  // ---- Mapeamento + pré-visualização ----
  const preview = summary ? summary.rows.slice(0, 6) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-bg px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileSpreadsheet className="size-5 shrink-0 text-brand-navy" />
          <span className="truncate text-sm font-semibold text-brand-ink">{fileName}</span>
          <span className="shrink-0 text-xs text-brand-ink-soft">
            {table.rowCount} linha(s) · {table.headers.length} coluna(s)
          </span>
        </div>
        <button type="button" onClick={reset} className="press flex items-center gap-1 text-xs font-semibold text-brand-ink-soft hover:text-brand-red">
          <X className="size-4" /> Trocar arquivo
        </button>
      </div>

      <div>
        <h4 className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">Confirme o mapeamento das colunas</h4>
        <p className="mb-3 mt-0.5 text-xs text-brand-ink-soft">
          Sugerimos o encaixe automaticamente. Ajuste o que precisar — campos com <span className="text-brand-red">*</span> são obrigatórios.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CANONICAL_FIELDS.map((field) => {
            const value = mapping[field.key] ?? NONE;
            const matched = value !== NONE;
            return (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-brand-ink">
                  {field.label}
                  {field.required ? <span className="text-brand-red"> *</span> : null}
                  {matched ? <CheckCircle2 className="ml-1 inline size-3.5 text-brand-green" /> : null}
                </span>
                <Select
                  value={value}
                  onValueChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (!v || v === NONE) delete next[field.key];
                      else next[field.key] = v;
                      return next;
                    })
                  }
                >
                  <SelectTrigger size="sm" className={cn(!matched && field.required && "border-brand-red/50")}>
                    <SelectValue placeholder="— não usar —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— não usar —</SelectItem>
                    {table.headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            );
          })}
        </div>
      </div>

      {summary ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
            <span className="text-brand-green">{summary.valid} válidos</span>
            {summary.invalid > 0 ? <span className="text-brand-red">{summary.invalid} com problema</span> : null}
            {summary.warnings > 0 ? <span className="text-brand-orange">{summary.warnings} para revisar</span> : null}
            <span className="text-brand-ink-soft">de {summary.total} linhas</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-brand-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Nome</th>
                  <th className="px-3 py-2 font-semibold">Preço</th>
                  <th className="px-3 py-2 font-semibold">Estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {preview.map((row) => (
                  <tr key={row.index} className={cn(row.errors.length > 0 && "bg-brand-red/5")}>
                    <td className="px-3 py-2">
                      {row.errors.length > 0 ? (
                        <span className="text-xs font-semibold text-brand-red" title={row.errors.join("; ")}>
                          Problema
                        </span>
                      ) : row.warnings.length > 0 ? (
                        <span className="text-xs font-semibold text-brand-orange" title={row.warnings.join("; ")}>
                          Revisar
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-brand-green">OK</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-brand-ink">{row.product?.sku ?? row.raw[mapping.sku ?? ""] ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-brand-ink">{row.product?.name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-brand-ink">
                      {row.product?.price != null ? row.product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-brand-ink">{row.product?.stock ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.total > preview.length ? (
            <p className="mt-2 text-xs text-brand-ink-soft">Mostrando as primeiras {preview.length} de {summary.total} linhas.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
