"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ClipboardList, Flame, HardHat, MessageCircle, Tags } from "lucide-react";

import type { Category } from "@/types/catalog";
import { MegaMenu } from "@/components/layout/mega-menu";
import { whatsappLink } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/ofertas", label: "Ofertas do dia", icon: Flame, tone: "text-brand-red" },
  { href: "/atacado", label: "Atacado", icon: Boxes, tone: "text-brand-orange" },
  { href: "/marcas", label: "Marcas", icon: Tags },
  { href: "/profissionais", label: "Profissionais", icon: HardHat },
  { href: "/orcamento", label: "Orçamento de obra", icon: ClipboardList },
];

/** Linha de navegação (desktop): mega-menu à esquerda, atalhos e WhatsApp à direita. */
export function NavBar({ categories }: { categories: Category[] }) {
  const pathname = usePathname();
  return (
    <nav data-site-chrome aria-label="Principal" className="hidden border-b border-brand-line bg-card lg:block">
      <div className="container-ccm flex h-14 items-center gap-2">
        <MegaMenu categories={categories} />
        <ul className="ml-2 flex items-center gap-1">
          {LINKS.map(({ href, label, icon: I, tone }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "relative inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[0.85rem] font-semibold whitespace-nowrap text-brand-ink transition-colors hover:bg-muted hover:text-brand-navy xl:px-3 xl:text-[0.9rem] dark:hover:text-foreground",
                    "after:absolute after:inset-x-3 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-brand-yellow after:opacity-0 after:transition-opacity",
                    active && "text-brand-navy after:opacity-100 dark:text-foreground",
                  )}
                >
                  <I className={cn("size-4", tone)} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <a
          href={whatsappLink("Olá! Quero um orçamento na Multigiro Central de Compras.")}
          target="_blank"
          rel="noreferrer"
          className="press ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3.5 text-sm font-bold whitespace-nowrap text-brand-green transition-colors hover:bg-brand-green hover:text-white"
          aria-label="Fale com um vendedor pelo WhatsApp"
        >
          <MessageCircle className="size-4" />
          <span className="xl:hidden">Vendedor</span>
          <span className="hidden xl:inline">Fale com um vendedor</span>
        </a>
      </div>
    </nav>
  );
}
