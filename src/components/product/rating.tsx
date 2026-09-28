import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

export function Rating({ value, count, className, size = "sm" }: { value?: number; count?: number; className?: string; size?: "sm" | "md" }) {
  if (!value) return null;
  const rounded = Math.round(value * 2) / 2;
  return (
    <div className={cn("flex items-center gap-1.5", className)} aria-label={`Avaliação ${value.toFixed(1)} de 5${count ? `, ${count} avaliações` : ""}`}>
      <div className="flex items-center gap-px" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => {
          const fill = rounded >= i + 1 ? 1 : rounded >= i + 0.5 ? 0.5 : 0;
          return (
            <span key={i} className={cn("relative inline-block", size === "sm" ? "size-3" : "size-4")}>
              <Star className="absolute inset-0 size-full text-brand-line" fill="currentColor" strokeWidth={0} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn("size-full text-brand-yellow-2", size === "sm" ? "size-3" : "size-4")} fill="currentColor" strokeWidth={0} />
              </span>
            </span>
          );
        })}
      </div>
      <span className={cn("font-medium text-brand-ink-soft", size === "sm" ? "text-[0.7rem]" : "text-sm")}>
        {value.toFixed(1)}
        {count ? ` (${count})` : ""}
      </span>
    </div>
  );
}
