"use client";

import { Code2, FileSpreadsheet, PencilLine, Plug, Rss, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { INTEGRATION_METHODS, type MethodDef } from "@/lib/integrations/connectors";
import type { IntegrationMethod } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Plug,
  FileSpreadsheet,
  Code2,
  Rss,
  PencilLine,
};

export function MethodCards({
  selected,
  onSelect,
}: {
  selected?: IntegrationMethod | null;
  onSelect: (method: MethodDef) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {INTEGRATION_METHODS.map((method) => {
        const Icon = ICONS[method.icon] ?? Plug;
        const comingSoon = method.status === "coming_soon";
        const isSelected = selected === method.id;
        return (
          <button
            key={method.id}
            type="button"
            onClick={() => onSelect(method)}
            aria-pressed={isSelected}
            className={cn(
              "press group relative flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition-colors",
              "hover:border-brand-navy/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isSelected ? "border-brand-navy ring-2 ring-brand-navy/30" : "border-brand-line",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-xl transition-colors",
                  isSelected ? "bg-brand-navy text-white" : "bg-brand-yellow-soft text-brand-navy group-hover:bg-brand-yellow",
                )}
              >
                <Icon className="size-5" strokeWidth={2.2} />
              </span>
              {comingSoon ? (
                <Badge variant="secondary" className="bg-brand-line/60 text-brand-ink-soft">
                  Em breve
                </Badge>
              ) : (
                <Badge className="bg-brand-green-soft text-brand-green">Disponível</Badge>
              )}
            </div>
            <div>
              <h3 className="font-heading text-base font-bold text-brand-navy dark:text-foreground">{method.title}</h3>
              <p className="mt-1 text-sm leading-snug text-brand-ink-soft">{method.tagline}</p>
            </div>
            <span className="mt-auto text-xs font-semibold text-brand-ink-soft">{method.effort}</span>
          </button>
        );
      })}
    </div>
  );
}
