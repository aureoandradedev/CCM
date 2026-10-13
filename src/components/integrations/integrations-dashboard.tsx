"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Boxes, Plug, RefreshCw, Settings2, Trash2 } from "lucide-react";

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

  function syncNow(id: string) {
    updateIntegration(id, { status: "syncing" });
    setTimeout(() => {
      updateIntegration(id, { status: "connected", lastSyncAt: new Date().toISOString() });
      toast.success("Catálogo atualizado", {
        description: "A sincronização automática em tempo real entra com a conexão de ERP/API.",
      });
    }, 800);
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
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Nenhuma integração ainda</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-brand-ink-soft">
          Conecte sua empresa ao CCM e comece a vender. Leva poucos minutos.
        </p>
        <Button variant="brand" size="lg" render={<Link href="/fornecedores/integrar" />} className="mt-4">
          Integrar minha empresa
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

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Produtos" value={it.productCount.toLocaleString("pt-BR")} />
              <Metric label="Prontos" value={it.validCount.toLocaleString("pt-BR")} tone="green" />
              <Metric label="Com erro" value={it.errorCount.toLocaleString("pt-BR")} tone={it.errorCount > 0 ? "red" : "slate"} />
            </div>

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

function Metric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "green" | "red" }) {
  const color = tone === "green" ? "text-brand-green" : tone === "red" ? "text-brand-red" : "text-brand-ink";
  return (
    <div className="rounded-xl border border-brand-line bg-brand-bg px-4 py-3">
      <p className={cn("font-heading text-xl font-extrabold tabular-nums", color)}>{value}</p>
      <p className="text-xs font-semibold text-brand-ink-soft">{label}</p>
    </div>
  );
}
