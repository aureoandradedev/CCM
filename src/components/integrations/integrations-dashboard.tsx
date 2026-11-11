"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Boxes, CheckCircle2, Clock, FileSearch, Plug, RefreshCw, Settings2, ShoppingCart, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getIntegrationsSnapshot,
  getServerIntegrationsSnapshot,
  removeIntegration,
  subscribeIntegrations,
  updateIntegration,
  type ConnectedIntegration,
} from "@/lib/integrations/session-store";
import { CAPABILITY_LABELS, methodById } from "@/lib/integrations/connectors";
import { resyncCatalog } from "@/app/fornecedores/sync-pipeline";
import { cn } from "@/lib/utils";

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dia(s)`;
}

const STATUS_STYLE: Record<ConnectedIntegration["status"], { dot: string; label: string }> = {
  connected: { dot: "bg-brand-green", label: "Conectado" },
  syncing: { dot: "bg-brand-orange animate-pulse", label: "Sincronizando" },
  error: { dot: "bg-brand-red", label: "Com erro" },
  paused: { dot: "bg-brand-ink-soft", label: "Pausado" },
};

export function IntegrationsDashboard() {
  const items = useSyncExternalStore(
    subscribeIntegrations,
    getIntegrationsSnapshot,
    getServerIntegrationsSnapshot,
  );

  async function syncNow(id: string) {
    updateIntegration(id, { status: "syncing" });
    try {
      const result = await resyncCatalog();
      if (!result.ok) {
        updateIntegration(id, { status: "error", lastSyncAt: new Date().toISOString() });
        toast.error("Erro na sincronização", { description: result.error });
        return;
      }
      const c = result.counts;
      updateIntegration(id, {
        status: "connected",
        lastSyncAt: new Date().toISOString(),
        validCount: c.auto_approved + c.offers_created + c.offers_versioned,
        errorCount: c.errors + c.offers_errors,
        pipelineState: {
          normalized: c.normalized,
          matched: c.auto_approved,
          review: c.revisao_manual,
          offers: c.offers_created + c.offers_versioned,
          errors: c.errors + c.offers_errors,
        },
      });
      const parts: string[] = [];
      if (c.normalized > 0) parts.push(`${c.normalized} normalizados`);
      if (c.auto_approved > 0) parts.push(`${c.auto_approved} associados`);
      if (c.offers_created > 0) parts.push(`${c.offers_created} ofertas criadas`);
      if (c.offers_versioned > 0) parts.push(`${c.offers_versioned} ofertas atualizadas`);
      if (c.revisao_manual > 0) parts.push(`${c.revisao_manual} em revisão`);
      toast.success("Pipeline concluído", {
        description: parts.join(", ") || "Nenhum item pendente.",
      });
    } catch {
      updateIntegration(id, { status: "error", lastSyncAt: new Date().toISOString() });
      toast.error("Erro de conexão", { description: "Verifique sua internet e tente novamente." });
    }
  }

  function toggleAuto(it: ConnectedIntegration) {
    updateIntegration(it.id, { autoSync: !it.autoSync });
  }

  function disconnect(id: string) {
    removeIntegration(id);
    toast("Integração desconectada");
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center">
        <span className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-yellow-soft text-brand-navy">
          <Plug className="size-7" strokeWidth={2} />
        </span>
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Nenhuma integracao ainda</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-brand-ink-soft">
          Conecte seu catalogo ao CCM. Seus produtos passam por analise antes de entrar na vitrine.
        </p>
        <Button variant="brand" size="lg" render={<Link href="/fornecedores/integrar" />} className="mt-4">
          Conectar meu catalogo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((it) => {
        const status = STATUS_STYLE[it.status];
        const methodLabel = methodById(it.method)?.title ?? it.method;
        return (
          <div key={it.id} className="rounded-2xl border border-brand-line bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-navy/5 text-brand-navy">
                  <Boxes className="size-5" />
                </span>
                <div>
                  <h3 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">{it.name}</h3>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-brand-ink-soft">
                    <span className={cn("inline-block size-2 rounded-full", status.dot)} />
                    <span className="font-semibold">{status.label}</span>
                    <span>·</span>
                    <span>{methodLabel}</span>
                    <span>·</span>
                    <span>Última sincronização: {timeAgo(it.lastSyncAt)}</span>
                  </div>
                </div>
              </div>
              <Button variant="navy" size="sm" onClick={() => syncNow(it.id)} disabled={it.status === "syncing"} className="gap-1">
                <RefreshCw className={cn("size-4", it.status === "syncing" && "animate-spin")} /> Sincronizar agora
              </Button>
            </div>

            {it.pipelineState ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-5">
                <Metric label="Importados" value={it.productCount.toLocaleString("pt-BR")} icon={<Boxes className="size-4" />} />
                <Metric label="Normalizados" value={it.pipelineState.normalized.toLocaleString("pt-BR")} icon={<FileSearch className="size-4" />} tone="blue" />
                <Metric label="Associados" value={it.pipelineState.matched.toLocaleString("pt-BR")} icon={<CheckCircle2 className="size-4" />} tone="green" />
                <Metric label="Em revisão" value={it.pipelineState.review.toLocaleString("pt-BR")} icon={<Clock className="size-4" />} tone={it.pipelineState.review > 0 ? "orange" : "slate"} />
                <Metric label="Ofertas" value={it.pipelineState.offers.toLocaleString("pt-BR")} icon={<ShoppingCart className="size-4" />} tone="green" />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="Produtos" value={it.productCount.toLocaleString("pt-BR")} />
                <Metric label="Válidos" value={it.validCount.toLocaleString("pt-BR")} tone="green" />
                <Metric label="Com erro" value={it.errorCount.toLocaleString("pt-BR")} tone={it.errorCount > 0 ? "red" : "slate"} />
              </div>
            )}

            {it.pipelineState && it.pipelineState.errors > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-red/20 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">
                <XCircle className="size-4 shrink-0" />
                {it.pipelineState.errors} erro(s) no pipeline
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {it.capabilities.map((c) => (
                <Badge key={c} variant="secondary" className="bg-brand-green-soft text-brand-green">
                  {CAPABILITY_LABELS[c]}: sincronizado
                </Badge>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-line pt-3">
              <button type="button" onClick={() => toggleAuto(it)} className="press flex items-center gap-2 text-sm text-brand-ink">
                <span
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    it.autoSync ? "bg-brand-green" : "bg-brand-line",
                  )}
                >
                  <span className={cn("inline-block size-4 translate-x-0.5 rounded-full bg-white transition-transform", it.autoSync && "translate-x-[18px]")} />
                </span>
                Sincronização automática
              </button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1 text-brand-ink-soft" disabled title="Em breve">
                  <Settings2 className="size-4" /> Configurações
                </Button>
                <Button variant="ghost" size="sm" onClick={() => disconnect(it.id)} className="gap-1 text-brand-ink-soft hover:text-brand-red">
                  <Trash2 className="size-4" /> Desconectar
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex justify-center pt-2">
        <Button variant="outline-navy" render={<Link href="/fornecedores/integrar" />}>
          + Conectar outro sistema
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "slate", icon }: { label: string; value: string; tone?: "slate" | "green" | "red" | "orange" | "blue"; icon?: React.ReactNode }) {
  const color =
    tone === "green" ? "text-brand-green"
    : tone === "red" ? "text-brand-red"
    : tone === "orange" ? "text-brand-orange"
    : tone === "blue" ? "text-brand-navy"
    : "text-brand-ink";
  return (
    <div className="rounded-xl border border-brand-line bg-brand-bg px-4 py-3">
      <div className="flex items-center gap-2">
        {icon && <span className={cn("opacity-60", color)}>{icon}</span>}
        <p className={cn("font-heading text-xl font-extrabold tabular-nums", color)}>{value}</p>
      </div>
      <p className="mt-0.5 text-xs font-semibold text-brand-ink-soft">{label}</p>
    </div>
  );
}
