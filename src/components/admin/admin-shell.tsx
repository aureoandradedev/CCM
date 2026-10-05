"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Calculator,
  ExternalLink,
  LayoutDashboard,
  Layers,
  LogOut,
  Megaphone,
  Menu,
  PackageSearch,
  Percent,
  Settings,
  ShoppingBag,
  Tag,
  Truck,
  Users,
  Wallpaper,
  X,
} from "lucide-react";
import { useState } from "react";

import { signOut } from "@/app/conta/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Painel", icon: LayoutDashboard, exact: true },
  { href: "/admin/pedidos", label: "Pedidos", icon: PackageSearch },
  { href: "/admin/caixa", label: "Fechamento de caixa", icon: Calculator },
  { href: "/admin/bi", label: "BI · Faturamento", icon: BarChart3 },
  { href: "/admin/produtos", label: "Produtos", icon: ShoppingBag },
  { href: "/admin/ofertas", label: "Ofertas (colar lista)", icon: Tag },
  { href: "/admin/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/admin/conteudo", label: "Conteúdo do site", icon: Wallpaper },
  { href: "/admin/descontos", label: "Descontos", icon: Percent },
  { href: "/admin/clientes", label: "Clientes e leads", icon: Users },
  { href: "/admin/categorias", label: "Categorias", icon: Layers },
  { href: "/admin/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export function AdminShell({ children, adminName, pendentes }: { children: React.ReactNode; adminName: string; pendentes: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Admin">
      {NAV.map(({ href, label, icon: I, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors",
              active ? "bg-brand-yellow text-brand-navy" : "text-white/80 hover:bg-white/10 hover:text-white",
            )}
          >
            <I className="size-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {href === "/admin/pedidos" && pendentes > 0 ? <span className="rounded-full bg-brand-red px-1.5 text-[0.65rem] font-bold text-white">{pendentes}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="admin-root flex min-h-dvh bg-brand-bg">
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-navy text-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
          <Image src="/brand/mascote-head.png" alt="" width={36} height={36} className="size-9 rounded-full bg-white" />
          <div className="leading-tight">
            <p className="font-heading text-base font-extrabold">CCM Admin</p>
            <p className="text-[0.68rem] text-white/60">Central de Compras</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-white/10 p-3 text-xs text-white/70">
          <p className="truncate px-3">{adminName}</p>
          <div className="mt-1 flex items-center gap-1">
            <Link href="/" className="flex h-9 flex-1 items-center gap-2 rounded-lg px-3 hover:bg-white/10">
              <ExternalLink className="size-3.5" /> Ver loja
            </Link>
            <form action={signOut}>
              <button type="submit" className="flex h-9 items-center gap-2 rounded-lg px-3 hover:bg-white/10">
                <LogOut className="size-3.5" /> Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-brand-line bg-card px-4 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex size-10 items-center justify-center rounded-lg text-brand-navy" aria-label="Abrir menu">
            <Menu className="size-6" />
          </button>
          <p className="font-heading text-lg font-extrabold text-brand-navy">CCM Admin</p>
          <Link href="/" className="ml-auto text-xs font-semibold text-brand-navy underline">
            Ver loja
          </Link>
        </header>

        {open ? (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fechar" onClick={() => setOpen(false)} />
            <aside className="relative flex h-full w-72 flex-col bg-brand-navy text-white">
              <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
                <p className="font-heading font-extrabold">CCM Admin</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10">
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{nav}</div>
              <form action={signOut} className="border-t border-white/10 p-3">
                <button type="submit" className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-white/10">
                  <LogOut className="size-4" /> Sair
                </button>
              </form>
            </aside>
          </div>
        ) : null}

        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function AdminIcon() {
  return <Boxes className="size-4" />;
}
