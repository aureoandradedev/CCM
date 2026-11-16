import { Flame, Sparkles, Star, Truck } from "lucide-react";

import type { ProductBadge } from "@/types/catalog";
import { cn } from "@/lib/utils";

const CONFIG: Partial<Record<ProductBadge, { label: string; className: string; icon?: React.ComponentType<{ className?: string }> }>> = {
  oferta: { label: "Oferta", className: "bg-brand-red text-white", icon: Flame },
  "mais-vendido": { label: "Mais vendido", className: "bg-brand-navy text-white", icon: Star },
  novo: { label: "Novo", className: "bg-brand-green text-white", icon: Sparkles },
  lancamento: { label: "Lançamento", className: "bg-brand-green text-white", icon: Sparkles },
  "frete-gratis": { label: "Frete grátis", className: "bg-brand-blue text-white", icon: Truck },
};

export function ProductBadges({ badges, discountPct, max = 2, className }: { badges?: ProductBadge[]; discountPct?: number; max?: number; className?: string }) {
  const list = (badges ?? []).filter((b) => b in CONFIG).slice(0, max);
  if (!list.length && !discountPct) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {discountPct ? (
        <span className="inline-flex h-6 items-center rounded-md bg-brand-red px-2 font-heading text-xs font-extrabold text-white">
          -{discountPct}%
        </span>
      ) : null}
      {list.map((b) => {
        const c = CONFIG[b]!;
        const I = c.icon;
        return (
          <span key={b} className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-[0.7rem] font-bold", c.className)}>
            {I ? <I className="size-3" /> : null}
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
