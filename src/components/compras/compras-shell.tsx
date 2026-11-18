"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardList,
  ExternalLink,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Scale,
  ShieldAlert,
  Truck,
  X,
} from "lucide-react";
import { useState } from "react";

import { signOut } from "@/app/conta/actions";
import { cn } from "@/lib/utils";

const NAV: readonly { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { href: "/compras", label: "Painel", icon: LayoutDashboard, exact: true },
  { href: "/compras/pendencias", label: "Pendências", icon: Layers },
  { href: "/compras/matching", label: "Identificação", icon: Scale },
  { href: "/compras/catalogos", label: "Catálogos", icon: ClipboardList },
  { href: "/compras/pedidos", label: "Pedidos de compra", icon: Package },
  { href: "/compras/fornecedores", label: "Fornecedores", icon: Truck },
  { href: "/compras/excecoes", label: "Exceções", icon: ShieldAlert },
];

export function ComprasShell({
  children,
  userName,
  pendenciaCount = 0,
}: {
  children: React.ReactNode;
  userName: string;
  pendenciaCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Compras">
      {NAV.map(({ href, label, icon: I, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        const badge = href === "/compras/pendencias" ? pendenciaCount : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors",
              active
                ? "bg-brand-yellow text-brand-navy"
                : "text-white/80 hover:bg-white/10 hover:text-white",
            )}
          >
            <I className="size-4 shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            {badge > 0 && (
              <span className="rounded-full bg-brand-red px-1.5 text-[0.65rem] font-bold text-white">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="admin-root flex min-h-dvh bg-brand-bg">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-navy text-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
          <Image
            src="/brand/mascote-head.png"
            alt=""
            width={36}
            height={36}
            className="size-9 rounded-full bg-white"
          />
          <div className="flex-1 leading-tight">
            <p className="font-heading text-base font-extrabold">Compras</p>
            <p className="text-[0.68rem] text-white/60">Central de Compras</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-white/10 p-3 text-xs text-white/70">
          <p className="truncate px-3">{userName}</p>
          <div className="mt-1 flex items-center gap-1">
            <Link
              href="/"
              className="flex h-9 flex-1 items-center gap-2 rounded-lg px-3 hover:bg-white/10"
            >
              <ExternalLink className="size-3.5" /> Ver loja
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="flex h-9 items-center gap-2 rounded-lg px-3 hover:bg-white/10"
              >
                <LogOut className="size-3.5" /> Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile header + drawer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-brand-line bg-card px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex size-10 items-center justify-center rounded-lg text-brand-navy"
            aria-label="Abrir menu"
          >
            <Menu className="size-6" />
          </button>
          <div className="flex items-center gap-2">
            <Boxes className="size-5 text-brand-navy" />
            <p className="font-heading text-lg font-extrabold text-brand-navy">
              Compras
            </p>
          </div>
          <div className="ml-auto">
            <Link
              href="/"
              className="text-xs font-semibold text-brand-navy underline"
            >
              Ver loja
            </Link>
          </div>
        </header>

        {open ? (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label="Fechar"
              onClick={() => setOpen(false)}
            />
            <aside className="relative flex h-full w-72 flex-col bg-brand-navy text-white">
              <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
                <p className="font-heading font-extrabold">Compras</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar menu"
                  className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{nav}</div>
              <form action={signOut} className="border-t border-white/10 p-3">
                <button
                  type="submit"
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-white/10"
                >
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
