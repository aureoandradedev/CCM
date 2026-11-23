"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  FileText,
  Loader2,
  PencilLine,
  Plug,
  Rss,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CsvImporter, type CsvResult } from "@/components/integrations/csv-importer";
import { ManualImporter } from "@/components/integrations/manual-importer";
import { ErpPanel, ApiPanel, FeedPanel } from "@/components/integrations/prepared-panels";
import { adminImportCatalog, type AdminImportResult } from "@/app/admin/fornecedores/actions";
import type { ImportSummary } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

type Method = "csv" | "manual" | "api" | "erp" | "feed" | "pdf";

type MethodStatus = "available" | "config_only" | "coming_soon";

interface MethodCard {
  id: Method;
  label: string;
  desc: string;
  Icon: LucideIcon;
  status: MethodStatus;
}

const STATUS_BADGE: Record<MethodStatus, { label: string; cls: string }> = {
  available: { label: "Disponível", cls: "bg-brand-green-soft text-brand-green" },
  config_only: { label: "Sincronização em breve", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  coming_soon: { label: "Em breve", cls: "bg-brand-line/60 text-brand-ink-soft" },
};

const METHODS: MethodCard[] = [
  { id: "csv", label: "Planilha CSV/XLSX", desc: "Importar catálogo a partir de arquivo do fornecedor.", Icon: FileSpreadsheet, status: "available" },
  { id: "manual", label: "Cadastrar manualmente", desc: "Digitar produtos diretamente no painel.", Icon: PencilLine, status: "available" },
  { id: "api", label: "Conectar via API", desc: "Configuração e validação disponíveis. Sincronização automática de catálogo em breve.", Icon: Code2, status: "config_only" },
  { id: "erp", label: "Conectar ERP", desc: "Conectar o ERP do fornecedor para sincronização automática.", Icon: Plug, status: "coming_soon" },
  { id: "feed", label: "Feed / URL", desc: "Ler feed JSON, XML ou CSV remoto periodicamente.", Icon: Rss, status: "coming_soon" },
  { id: "pdf", label: "Importar PDF", desc: "Extrair itens de catálogo em PDF do fornecedor.", Icon: FileText, status: "coming_soon" },
];

export function AdminImportClient({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const [method, setMethod] = useState<Method | null>(null);
  const [csvResult, setCsvResult] = useState<CsvResult | null>(null);
  const [manualSummary, setManualSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<AdminImportResult | null>(null);

  const summary = method === "csv" ? csvResult?.summary : method === "manual" ? manualSummary : null;
  const canImport = summary && summary.valid > 0 && !importing && !result;

  async function handleImport() {
    if (!summary) return;
    setImporting(true);
    try {
      const products = summary.rows
        .filter((r) => r.product)
        .map((r) => r.product!);

      const res = await adminImportCatalog({
        supplierId,
        sourceType: method === "csv" ? (csvResult?.sourceType ?? "csv") : "manual",
        sourceName: method === "csv" ? (csvResult?.sourceName ?? "arquivo") : "manual",
        products,
        totals: {
          total: summary.total,
          valid: summary.valid,
          invalid: summary.invalid,
          warnings: summary.warnings,
        },
      });
      setResult(res);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setMethod(null);
    setCsvResult(null);
    setManualSummary(null);
    setResult(null);
  }

  if (result) {
    const proc = result.processing;
    const phases = proc?.phases ?? [];
    const reusePhase = phases.find((p) => p.phase === "reuse_bindings");
    const normPhase = phases.find((p) => p.phase === "normalize");
    const matchPhase = phases.find((p) => p.phase === "match");
    const autoApprovePhase = phases.find((p) => p.phase === "auto_approve");
    const offersPhase = phases.find((p) => p.phase === "offers");

    const autoApproved = autoApprovePhase?.updated ?? 0;
    const offersCreated = (offersPhase?.created ?? 0) + (offersPhase?.updated ?? 0);
    const report = proc?.item_report ?? [];
    const pendenciaItems = report.filter(
      (r) => r.after_status === "match_sugerido" || r.after_status === "revisao_manual" || r.after_status === "normalizado",
    );

    const processingFailed = proc && proc.status === "failed";
    const processingOk = proc && (proc.status === "completed" || proc.status === "partial");

    return (
      <div className="rounded-2xl border border-brand-line bg-card p-6">
        {result.ok ? (
          <>
            <div className="text-center">
              <CheckCircle2 className="mx-auto size-12 text-green-600" />
              <h3 className="mt-3 font-heading text-lg font-bold text-brand-navy dark:text-foreground">
                Catálogo importado e processado automaticamente
              </h3>
              <p className="mt-1 text-sm text-brand-ink-soft">
                {result.counts?.inserted ?? 0} produto(s) inseridos para {supplierName}.
              </p>
            </div>

            {processingOk && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-green-50 p-3 text-center dark:bg-green-900/20">
                  <span className="text-xl font-bold text-green-700 dark:text-green-400">{autoApproved}</span>
                  <p className="text-[11px] text-green-800 dark:text-green-300">Auto-aprovados</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-3 text-center dark:bg-blue-900/20">
                  <span className="text-xl font-bold text-blue-700 dark:text-blue-400">{offersCreated}</span>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300">Ofertas criadas</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-center dark:bg-amber-900/20">
                  <span className="text-xl font-bold text-amber-700 dark:text-amber-400">{pendenciaItems.length}</span>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">Enviados p/ Pendências</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-800/30">
                  <span className="text-xl font-bold text-gray-700 dark:text-gray-300">{reusePhase?.updated ?? 0}</span>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400">Vínculos reutilizados</p>
                </div>
              </div>
            )}

            {processingFailed && (
              <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                O catálogo foi importado, mas o processamento automático falhou: {proc?.error ?? "erro desconhecido"}.
                Vá em Compras → Catálogos e processe manualmente.
              </p>
            )}

            {report.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-brand-navy hover:underline dark:text-blue-400">
                  Relatório por item ({report.length})
                </summary>
                <div className="mt-2 max-h-64 overflow-auto rounded border border-brand-line text-[11px]">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-brand-line bg-gray-50 text-left text-[10px] font-bold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <th className="px-2 py-1">SKU</th>
                        <th className="px-2 py-1">Nome</th>
                        <th className="px-2 py-1">Antes</th>
                        <th className="px-2 py-1">Depois</th>
                        <th className="px-2 py-1 text-right">Conf.</th>
                        <th className="px-2 py-1">Master</th>
                        <th className="px-2 py-1">Oferta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.map((r) => (
                        <tr key={r.id} className="border-b border-brand-line last:border-0">
                          <td className="px-2 py-1 text-gray-500">{r.supplier_sku ?? "—"}</td>
                          <td className="max-w-[140px] truncate px-2 py-1 font-medium">{r.name}</td>
                          <td className="px-2 py-1 text-gray-500">{r.before_status}</td>
                          <td className={`px-2 py-1 font-medium ${r.after_status === "aprovado" ? "text-green-700" : r.after_status === "normalizado" || r.after_status === "revisao_manual" || r.after_status === "match_sugerido" ? "text-amber-700" : "text-gray-600"}`}>
                            {r.after_status}
                          </td>
                          <td className="px-2 py-1 text-right">{r.match_confidence != null ? `${r.match_confidence}%` : "—"}</td>
                          <td className="max-w-[120px] truncate px-2 py-1 text-gray-500">{r.master_product_name ?? "—"}</td>
                          <td className="px-2 py-1 text-gray-500">{r.offer_action ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Phase details for debugging */}
            {phases.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] text-brand-fg/40 hover:underline">
                  Detalhes das fases ({proc?.duration_ms ?? 0}ms)
                </summary>
                <div className="mt-1 space-y-0.5 text-[10px] text-brand-fg/50">
                  {phases.map((p) => (
                    <p key={p.phase}>
                      {p.phase}: {p.ok ? "ok" : "falha"} — processados={p.processed} atualizados={p.updated} criados={p.created} erros={p.errors} ignorados={p.skipped}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : (
          <p className="text-center text-sm font-semibold text-red-600">{result.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!method && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METHODS.map((m) => {
            const badge = STATUS_BADGE[m.status];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={cn(
                  "flex flex-col items-start gap-3 rounded-2xl border border-brand-line bg-card p-5 text-left transition-colors",
                  "hover:border-brand-navy/40",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-yellow-soft text-brand-navy">
                    <m.Icon className="size-5" strokeWidth={2.2} />
                  </span>
                  <Badge variant="secondary" className={badge.cls}>{badge.label}</Badge>
                </div>
                <div>
                  <h3 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">{m.label}</h3>
                  <p className="mt-1 text-sm text-brand-ink-soft">{m.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {method === "csv" && <CsvImporter onChange={setCsvResult} />}
      {method === "manual" && <ManualImporter onChange={setManualSummary} />}
      {method === "api" && <ApiPanel />}
      {method === "erp" && <ErpPanel />}
      {method === "feed" && <FeedPanel />}
      {method === "pdf" && (
        <div className="rounded-2xl border border-brand-line bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-yellow-soft text-brand-navy">
              <FileText className="size-5" strokeWidth={2.2} />
            </span>
            <div>
              <h3 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Importar PDF</h3>
              <Badge variant="secondary" className="mt-1 bg-brand-line/60 text-brand-ink-soft">Em breve</Badge>
            </div>
          </div>
          <p className="mt-4 text-sm text-brand-ink-soft">
            Será possível enviar um PDF de catálogo do fornecedor e o sistema extrairá automaticamente SKU, descrição,
            marca, preço, unidade e estoque para revisão antes da importação.
          </p>
          <div className="mt-3 rounded-xl border border-brand-line bg-brand-bg px-4 py-3 text-xs text-brand-ink-soft">
            <p><strong>Suporte previsto:</strong> PDFs com texto selecionável (textual). PDFs escaneados (imagem) exigirão OCR, que será uma etapa futura.</p>
            <p className="mt-1">Enquanto isso, importe usando <strong>Planilha CSV/XLSX</strong> ou <strong>cadastro manual</strong>.</p>
          </div>
        </div>
      )}

      {method && (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={reset}>
            Voltar
          </Button>
          {canImport && (
            <Button variant="brand" onClick={handleImport} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Importando...
                </>
              ) : (
                `Importar ${summary.valid} produto(s)`
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
