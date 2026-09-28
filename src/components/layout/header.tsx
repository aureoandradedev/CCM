import Link from "next/link";
import { PackageSearch, UserRound } from "lucide-react";

import { CartButton } from "@/components/cart/cart-button";
import { Logo } from "@/components/layout/logo";
import { MobileMenu } from "@/components/layout/mobile-menu";
import { NavBar } from "@/components/layout/nav-bar";
import { SearchBar } from "@/components/layout/search-bar";
import { TopBar } from "@/components/layout/top-bar";
import { getCategories } from "@/lib/data/catalog";

/**
 * Cabeçalho: barra de utilidades, linha principal (logo, busca grande, conta,
 * pedidos, carrinho) fixa no topo, e a navegação com mega-menu no desktop.
 */
export async function Header() {
  const categories = await getCategories();

  // A linha principal precisa ser irmã (não filha) do restante para o `sticky`
  // valer na página inteira: um elemento sticky só gruda dentro do pai.
  return (
    <>
      <TopBar />

      <header className="sticky top-0 z-40 border-b border-brand-line bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="container-ccm flex h-[72px] items-center gap-3 md:gap-6">
          <div className="flex items-center gap-1 lg:hidden">
            <MobileMenu categories={categories} />
          </div>

          <Logo />

          <div className="hidden flex-1 md:block">
            <SearchBar />
          </div>

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <Link
              href="/conta"
              className="press hidden h-11 items-center gap-2 rounded-xl px-3 text-brand-navy transition-colors hover:bg-brand-yellow-soft lg:inline-flex dark:text-foreground dark:hover:bg-muted"
            >
              <UserRound className="size-6" strokeWidth={2.2} />
              <span className="flex flex-col items-start leading-none">
                <span className="text-[0.68rem] text-brand-ink-soft">Olá, visitante</span>
                <span className="text-sm font-bold">Entrar ou cadastrar</span>
              </span>
            </Link>
            <Link
              href="/conta/pedidos"
              className="press hidden h-11 items-center gap-2 rounded-xl px-3 text-brand-navy transition-colors hover:bg-brand-yellow-soft xl:inline-flex dark:text-foreground dark:hover:bg-muted"
            >
              <PackageSearch className="size-6" strokeWidth={2.2} />
              <span className="flex flex-col items-start leading-none">
                <span className="text-[0.68rem] text-brand-ink-soft">Acompanhe</span>
                <span className="text-sm font-bold">Meus pedidos</span>
              </span>
            </Link>
            <CartButton />
          </div>
        </div>

        <div className="container-ccm pb-3 md:hidden">
          <SearchBar />
        </div>
      </header>

      <NavBar categories={categories} />
    </>
  );
}
