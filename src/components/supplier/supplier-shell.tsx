"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, History, Building2, LogOut, Menu, X } from "lucide-react";

import { signOut } from "@/app/conta/actions";

interface SupplierShellProps {
  supplierName: string;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/fornecedores/painel", label: "Visão geral", icon: LayoutDashboard },
  { href: "/fornecedores/pedidos", label: "Solicitações", icon: ClipboardList },
  { href: "/fornecedores/historico", label: "Histórico", icon: History },
  { href: "/fornecedores/dados", label: "Dados da empresa", icon: Building2 },
] as const;

export function SupplierShell({ supplierName, children }: SupplierShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <header className="sticky top-0 z-30 bg-brand-navy text-white shadow-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 lg:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/mascote-head.png" alt="" width={32} height={32} className="size-8 rounded-full bg-white/90" />
            <div className="hidden h-6 w-px bg-white/20 sm:block" />
            <div className="flex flex-col leading-tight">
              <span className="font-heading text-sm font-bold tracking-wide">Portal Fornecedor</span>
              <span className="hidden text-[0.65rem] text-white/60 sm:block">{supplierName}</span>
            </div>
          </div>

          <div className="flex-1" />

          <span className="hidden text-xs text-white/70 lg:block">{supplierName}</span>

          <form action={signOut}>
            <button
              type="submit"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:inline-flex"
            >
              <LogOut className="size-3.5" />
              Sair
            </button>
          </form>

          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 top-14 z-20 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <nav className="w-64 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || (item.href !== "/fornecedores/painel" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-brand-navy/10 text-brand-navy" : "text-brand-ink-soft hover:bg-gray-100 hover:text-brand-navy"}`}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t border-brand-line pt-4">
              <form action={signOut}>
                <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-red transition-colors hover:bg-red-50">
                  <LogOut className="size-4" />
                  Sair
                </button>
              </form>
            </div>
          </nav>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-4xl flex-1 gap-6 px-4 py-5 lg:px-6 lg:py-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav>
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || (item.href !== "/fornecedores/painel" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-brand-navy/10 text-brand-navy" : "text-brand-ink-soft hover:bg-gray-100 hover:text-brand-navy"}`}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
