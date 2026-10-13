import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Marca oficial: wordmark "Multigiro · Central de Compras" (amarelo + azul)
 * com o mascote de corpo inteiro ao lado no desktop. Os arquivos ficam em
 * /public/brand. A imagem é retrato (686x961): altura fixa + largura automática
 * e object-contain para o mascote aparecer inteiro, sem corte.
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
          src="/brand/mascote-capacete-alpha.png"
          alt=""
          width={686}
          height={961}
          priority
          className="h-10 w-auto shrink-0 object-contain transition-transform duration-200 ease-[var(--ease-out)] group-hover:-rotate-6 sm:h-12 md:h-14"
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
