"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Truck, User } from "lucide-react";

import { signOut } from "@/app/conta/actions";
import { cn } from "@/lib/utils";

export function EntregadorShell({ children, userName }: { children: React.ReactNode; userName: string }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col bg-brand-bg">
      <header className="sticky top-0 z-30 border-b border-brand-line bg-brand-navy text-white">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
          <Image src="/brand/mascote-head.png" alt="" width={32} height={32} className="size-8 rounded-full bg-white" />
          <div className="flex-1">
            <p className="font-heading text-sm font-bold">Entregas</p>
            <p className="text-[0.65rem] text-white/60">{userName}</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Sair">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </header>

      <nav className="border-b border-brand-line bg-card">
        <div className="mx-auto flex max-w-lg gap-1 px-4">
          <NavLink href="/entregador" icon={<Truck className="size-4" />} label="Entregas" active={pathname === "/entregador" || pathname.startsWith("/entregador/")} />
          <NavLink href="/conta" icon={<User className="size-4" />} label="Minha conta" active={pathname.startsWith("/conta")} />
        </div>
      </nav>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4">{children}</main>
    </div>
  );
}

function NavLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
        active ? "border-brand-navy text-brand-navy" : "border-transparent text-brand-ink-soft hover:text-brand-navy",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
