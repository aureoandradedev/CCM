import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto genérico enquanto a rota carrega (reserva espaço, evita salto de layout). */
export default function Loading() {
  return (
    <div className="container-ccm pt-6" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-6 h-10 w-2/3 max-w-md" />
      <Skeleton className="mt-3 h-4 w-1/2 max-w-sm" />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-brand-line bg-card">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="space-y-2 p-3.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-3 h-7 w-1/2" />
              <Skeleton className="mt-2 h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
