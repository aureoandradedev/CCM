"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, PartyPopper, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MethodCards } from "./method-cards";
import { CsvImporter, type CsvResult } from "./csv-importer";
import { ManualImporter } from "./manual-importer";
import { ApiPanel, ErpPanel, FeedPanel } from "./prepared-panels";
import { isMethodAvailable, methodById } from "@/lib/integrations/connectors";
import {
  newIntegrationId,
  saveIntegration,
  type ConnectedIntegration,
} from "@/lib/integrations/session-store";
import { importCatalog } from "@/app/fornecedores/actions";
import type { CanonicalProduct, ImportSummary, IntegrationMethod, SyncCapability } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Método", "Configurar", "Revisar", "Pronto"];

/** Métodos que realmente importam um catálogo agora (geram etapas 3 e 4). */
const IMPORTS_CATALOG: IntegrationMethod[] = ["csv", "manual"];

export function IntegrationWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [method, setMethod] = useState<IntegrationMethod | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [sourceType, setSourceType] = useState<"csv" | "xlsx" | "manual">("csv");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onCsv = useCallback((r: CsvResult | null) => {
    setSummary(r?.summary ?? null);
    setSourceName(r?.sourceName ?? "");
    setSourceType(r?.sourceType ?? "csv");
  }, []);
  const onManual = useCallback((s: ImportSummary | null) => {
    setSummary(s);
    setSourceName("Cadastro manual");
    setSourceType("manual");
  }, []);

  const methodDef = method ? methodById(method) : null;
  const canImport = method != null && IMPORTS_CATALOG.includes(method);
  const canContinueStep2 = canImport && (summary?.valid ?? 0) > 0;

  function selectMethod(id: IntegrationMethod) {
    setMethod(id);
    setSummary(null);
    setSourceName("");
    setStep(2);
  }

  async function finish() {
    if (!method || !summary) return;
    setImporting(true);
    setImportError(null);

    const products = summary.rows
      .filter((r): r is typeof r & { product: CanonicalProduct } => !!r.product)
      .map((r) => r.product);

    try {
      const result = await importCatalog({
        sourceType,
        sourceName,
        products,
        totals: {
          total: summary.total,
          valid: summary.valid,
          invalid: summary.invalid,
          warnings: summary.warnings,
        },
      });

      if (!result.ok) {
        setImportError(result.error ?? "Erro ao importar catálogo.");
        setImporting(false);
        return;
      }
    } catch {
      setImportError("Erro de conexão. Verifique sua internet e tente novamente.");
      setImporting(false);
      return;
    }

    const caps: SyncCapability[] = ["products", "stock", "price"];
    if (summary.withImages > 0) caps.push("images");
    const entry: ConnectedIntegration = {
      id: newIntegrationId(),
      method,
      name:
        method === "csv"
          ? `Importação por planilha${sourceName ? ` — ${sourceName}` : ""}`
          : "Cadastro manual",
      status: "connected",
      productCount: summary.valid,
      validCount: summary.valid,
      errorCount: summary.invalid,
      capabilities: caps,
      autoSync: false,
      createdAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
    };
    saveIntegration(entry);
    setImporting(false);
    setStep(4);
  }

  return (
    <div className="space-y-8">
      <Stepper current={step} />

      {/* ETAPA 1 — escolher método */}
      {step === 1 ? (
        <section className="space-y-4">
          <header>
            <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">
              Como você quer conectar seu catálogo?
            </h2>
            <p className="mt-1 text-sm text-brand-ink-soft">Escolha o jeito mais fácil para a sua empresa. Dá para trocar depois.</p>
          </header>
          <MethodCards selected={method} onSelect={(m) => selectMethod(m.id)} />
        </section>
      ) : null}

      {/* ETAPA 2 — configurar */}
      {step === 2 && methodDef ? (
        <section className="space-y-5">
          <header>
            <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">{methodDef.title}</h2>
            <p className="mt-1 text-sm text-brand-ink-soft">{methodDef.tagline}</p>
          </header>

          <div className="rounded-2xl border border-brand-line bg-card p-5 md:p-6">
            {method === "csv" ? <CsvImporter onChange={onCsv} /> : null}
            {method === "manual" ? <ManualImporter onChange={onManual} /> : null}
            {method === "erp" ? <ErpPanel /> : null}
            {method === "api" ? <ApiPanel /> : null}
            {method === "feed" ? <FeedPanel /> : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(1)} className="gap-1 text-brand-ink-soft">
              <ArrowLeft className="size-4" /> Trocar método
            </Button>
            {canImport ? (
              <Button variant="brand" size="lg" disabled={!canContinueStep2} onClick={() => setStep(3)} className="gap-1">
                Revisar catálogo <ArrowRight className="size-4" />
              </Button>
            ) : (
              <span className="text-sm text-brand-ink-soft">
                {isMethodAvailable(method!) ? "Preparação disponível — conexão ativada ao criar sua conta de fornecedor." : "Este método entra em breve."}
              </span>
            )}
          </div>
        </section>
      ) : null}

      {/* ETAPA 3 — revisar */}
      {step === 3 && summary ? (
        <section className="space-y-5">
          <header>
            <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">Revisar catálogo</h2>
            <p className="mt-1 text-sm text-brand-ink-soft">Confira o que encontramos antes de importar o catálogo.</p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReviewStat label="Produtos encontrados" value={summary.total} tone="navy" />
            <ReviewStat label="Prontos para venda" value={summary.valid} tone="green" />
            <ReviewStat label="Precisam de revisão" value={summary.invalid + summary.warnings} tone="orange" />
            <ReviewStat label="Com estoque" value={summary.withStock} tone="slate" />
            <ReviewStat label="Com preço" value={summary.withPrice} tone="slate" />
            <ReviewStat label="Com imagem" value={summary.withImages} tone="slate" />
          </div>

          {summary.invalid > 0 ? (
            <p className="rounded-xl border border-brand-line bg-brand-yellow-soft/40 px-4 py-3 text-sm text-brand-ink">
              {summary.invalid} linha(s) com problema não serão importadas agora — você pode corrigir e reimportar depois.
              Os {summary.valid} itens válidos serão salvos no catálogo.
            </p>
          ) : null}

          {importError ? (
            <p className="rounded-xl border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm font-medium text-brand-red">
              {importError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={importing} className="gap-1 text-brand-ink-soft">
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            <Button variant="brand" size="lg" onClick={finish} disabled={summary.valid === 0 || importing} className="gap-1">
              {importing ? (
                <><Loader2 className="size-4 animate-spin" /> Importando...</>
              ) : (
                <><CheckCircle2 className="size-4" /> Importar catálogo</>
              )}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ETAPA 4 — pronto */}
      {step === 4 && summary ? (
        <section className="space-y-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-green-soft text-brand-green">
            <PartyPopper className="size-8" />
          </div>
          <div>
            <h2 className="font-heading text-2xl font-extrabold text-brand-navy dark:text-foreground">Catálogo importado com sucesso!</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-soft">
              Seu catálogo foi recebido pelo CCM. Os itens válidos foram salvos e seguem para análise;
              os que precisam de ajuste ficam separados para revisão.
            </p>
          </div>
          <div className="mx-auto grid max-w-lg gap-3 sm:grid-cols-3">
            <ReviewStat label="Encontrados" value={summary.total} tone="navy" />
            <ReviewStat label="Importados" value={summary.valid} tone="green" />
            <ReviewStat label="Com problema" value={summary.invalid + summary.warnings} tone="orange" />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="brand" size="lg" onClick={() => router.push("/fornecedores/integracoes")} className="gap-1">
              Ir para meus produtos <ArrowRight className="size-4" />
            </Button>
            <Button variant="outline-navy" size="lg" render={<Link href="/" />} className="gap-1">
              <Store className="size-4" /> Ver minha loja
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                active && "bg-brand-navy text-white",
                done && "bg-brand-green text-white",
                !active && !done && "bg-brand-line text-brand-ink-soft",
              )}
            >
              {done ? <CheckCircle2 className="size-4" /> : n}
            </span>
            <span className={cn("hidden text-xs font-semibold sm:inline", active ? "text-brand-navy dark:text-foreground" : "text-brand-ink-soft")}>
              {label}
            </span>
            {i < STEP_LABELS.length - 1 ? <span className={cn("h-0.5 flex-1 rounded-full", done ? "bg-brand-green" : "bg-brand-line")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

const TONES: Record<string, string> = {
  navy: "text-brand-navy",
  green: "text-brand-green",
  orange: "text-brand-orange",
  slate: "text-brand-ink",
};

function ReviewStat({ label, value, tone }: { label: string; value: number; tone: keyof typeof TONES }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-4">
      <p className={cn("font-heading text-3xl font-extrabold tabular-nums", TONES[tone])}>{value.toLocaleString("pt-BR")}</p>
      <p className="mt-1 text-xs font-semibold text-brand-ink-soft">{label}</p>
    </div>
  );
}
