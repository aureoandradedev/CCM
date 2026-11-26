"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ClipboardList, Flame, Headset, Menu, PackageSearch, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";

import type { Category } from "@/types/catalog";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { site, whatsappLink } from "@/lib/site";

/** Menu lateral do celular: departamentos com subcategorias expansíveis + atalhos. */
export function MobileMenu({ categories, userName, isAdmin, pendingPaymentCount = 0 }: { categories: Category[]; userName?: string | null; isAdmin?: boolean; pendingPaymentCount?: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // fecha ao navegar (ajuste de estado durante o render, sem efeito)
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-lg" className="text-brand-navy lg:hidden dark:text-foreground" aria-label="Abrir menu" />
        }
      >
        <Menu className="size-6" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-brand-line px-4 py-3">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Departamentos e atalhos</SheetDescription>
          <Logo />
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <ul className="grid gap-2 p-3">
            <li>
              <Link href="/ofertas" className="flex items-center gap-2 rounded-xl bg-brand-red/10 px-3 py-2.5 text-sm font-bold text-brand-red">
                <Flame className="size-4" /> Ofertas do dia
              </Link>
            </li>
          </ul>

          <p className="px-4 pt-2 pb-1 text-[0.7rem] font-bold uppercase tracking-wider text-brand-ink-soft">Departamentos</p>
          <ul>
            {categories.map((c) => (
              <li key={c.slug} className="border-b border-brand-line last:border-0">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-brand-ink [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-yellow-soft text-brand-navy">
                      <Icon name={c.icon} className="size-4" />
                    </span>
                    <span className="flex-1">{c.name}</span>
                    <ChevronDown className="size-4 text-brand-ink-soft transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <ul className="bg-muted/50 pb-2">
                    <li>
                      <Link href={`/categoria/${c.slug}`} className="block px-4 py-2 pl-[3.75rem] text-sm font-bold text-brand-navy dark:text-foreground">
                        Ver tudo em {c.name}
                      </Link>
                    </li>
                    {c.children.map((s) => (
                      <li key={s.slug}>
                        <Link href={`/categoria/${c.slug}?sub=${s.slug}`} className="block px-4 py-2 pl-[3.75rem] text-sm text-brand-ink">
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>

          <p className="px-4 pt-4 pb-1 text-[0.7rem] font-bold uppercase tracking-wider text-brand-ink-soft">Atalhos</p>
          <ul className="pb-4">
            {[
              { href: "/conta", label: userName ? `Olá, ${userName} · Minha conta` : "Entrar ou cadastrar", icon: UserRound },
              { href: "/conta/pedidos", label: pendingPaymentCount > 0 ? `Meus pedidos · ${pendingPaymentCount}` : "Meus pedidos", icon: PackageSearch },
              { href: "/orcamento", label: "Orçamento de obra", icon: ClipboardList },
              ...(isAdmin ? [{ href: "/admin", label: "Painel admin", icon: ShieldCheck }] : []),
            ].map(({ href, label, icon: I }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-4 py-2.5 text-sm text-brand-ink">
                  <I className="size-4 text-brand-ink-soft" /> {label}
                </Link>
              </li>
            ))}
            <li>
              <a href={whatsappLink()} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-brand-green">
                <Headset className="size-4" /> Televendas {site.phone}
              </a>
            </li>
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
