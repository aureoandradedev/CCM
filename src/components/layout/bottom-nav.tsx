"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid2x2, House, Search, ShoppingCart, UserRound } from "lucide-react";

import { useHydrated } from "@/hooks/use-hydrated";
import { selectCount, useCartStore } from "@/lib/cart/store";
import { cn } from "@/lib/utils";

/**
 * Navegação inferior do celular (≤5 itens, Nielsen/mobile): mesma ideia do
 * bottomNav do Multigiro. O carrinho abre a gaveta em vez de trocar de página.
 */
export function BottomNav() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const count = useCartStore(selectCount);
  const open = useCartStore((s) => s.open);
  const n = hydrated ? count : 0;

  const item = (href: string, label: string, I: React.ComponentType<{ className?: string }>) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <li className="flex-1">
        <Link
          href={href}
          className={cn(
            "press flex h-full flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold text-brand-ink-soft",
            active && "text-brand-navy dark:text-brand-yellow",
          )}
          aria-current={active ? "page" : undefined}
        >
          <span className={cn("inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-brand-yellow-soft")}>
            <I className="size-5" />
          </span>
          {label}
        </Link>
      </li>
    );
  };

  return (
    <nav
      data-site-chrome
      aria-label="Navegação rápida"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="flex h-16 items-stretch">
        {item("/", "Início", House)}
        {item("/departamentos", "Departamentos", Grid2x2)}
        {item("/busca", "Buscar", Search)}
        <li className="flex-1">
          <button
            type="button"
            onClick={() => open()}
            className="press flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold text-brand-ink-soft"
            aria-label={`Abrir carrinho, ${n} itens`}
          >
            <span className="relative inline-flex h-7 w-12 items-center justify-center">
              <ShoppingCart className="size-5" />
              {n > 0 ? (
                <span key={n} className="absolute top-0 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-yellow px-1 font-heading text-[0.62rem] font-extrabold text-brand-navy animate-in zoom-in-75 duration-200">
                  {n > 99 ? "99+" : n}
                </span>
              ) : null}
            </span>
            Carrinho
          </button>
        </li>
        {item("/conta", "Conta", UserRound)}
      </ul>
    </nav>
  );
}
