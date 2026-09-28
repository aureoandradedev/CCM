import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Marca oficial: wordmark "Multigiro · Central de Compras" (amarelo + azul)
 * com a cabeça do mascote ao lado no desktop. Os arquivos ficam em /public/brand.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Multigiro Central de Compras. Página inicial"
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {!compact ? (
        <Image
          src="/brand/mascote-head.png"
          alt=""
          width={44}
          height={44}
          priority
          className="hidden size-10 shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-hover:-rotate-6 sm:block md:size-11"
        />
      ) : null}
      <Image
        src="/brand/logo-multigiro.webp"
        alt="Multigiro Central de Compras"
        width={300}
        height={69}
        priority
        className={cn("h-8 w-auto md:h-9", compact && "h-7")}
      />
    </Link>
  );
}
