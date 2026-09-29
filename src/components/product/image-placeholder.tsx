import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

/** Quadro neutro para produto sem foto (evita <Image src=""> e mantém o layout). */
export function ImagePlaceholder({ className, label = "Sem foto" }: { className?: string; label?: string }) {
  return (
    <div aria-hidden="true" className={cn("absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-brand-ink-soft", className)}>
      <ImageOff className="size-6 opacity-60" />
      {label ? <span className="text-[0.65rem] font-semibold uppercase tracking-wide opacity-70">{label}</span> : null}
    </div>
  );
}
