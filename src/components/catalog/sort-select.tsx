"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown } from "lucide-react";
import { useId, useTransition } from "react";

import { SORT_OPTIONS } from "@/lib/catalog-params";
import { cn } from "@/lib/utils";

export function SortSelect({ className }: { className?: string }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = sp.get("ordenar") ?? "relevance";

  const onChange = (value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value === "relevance") next.delete("ordenar");
    else next.set("ordenar", value);
    next.delete("pagina");
    startTransition(() => router.push(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false }));
  };

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        Ordenar por
      </label>
      <ArrowUpDown className="pointer-events-none absolute left-3 size-4 text-brand-ink-soft" aria-hidden="true" />
      <select
        id={id}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="h-10 cursor-pointer appearance-none rounded-lg border border-brand-line bg-card pl-9 pr-8 text-sm font-medium text-brand-ink outline-none transition-colors hover:border-brand-navy/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-3 size-3.5 text-brand-ink-soft" aria-hidden="true">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
