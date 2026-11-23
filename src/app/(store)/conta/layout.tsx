import Link from "next/link";
import { KeyRound, LayoutDashboard, LogOut, PackageSearch, Shield, ShieldCheck, UserRound } from "lucide-react";

import { signOut } from "@/app/conta/actions";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { firstName, getCurrentUser } from "@/lib/supabase/auth";

// sessão vem de cookies: nunca pré-renderizar
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/conta", label: "Visão geral", icon: LayoutDashboard },
  { href: "/conta/pedidos", label: "Meus pedidos", icon: PackageSearch },
  { href: "/conta/dados", label: "Meus dados", icon: UserRound },
  { href: "/conta/senha", label: "Senha", icon: KeyRound },
  { href: "/conta/privacidade", label: "Privacidade", icon: Shield },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;

  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Minha conta" }]} />
      <div className="mt-4 grid gap-6 md:mt-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-brand-line bg-card p-4">
            <p className="text-xs text-brand-ink-soft">Olá,</p>
            <p className="font-heading text-lg font-extrabold text-brand-navy">{firstName(user)}</p>
            <nav className="mt-3 flex gap-1 overflow-x-auto lg:flex-col" aria-label="Minha conta">
              {NAV.map(({ href, label, icon: I }) => (
                <Link key={href} href={href} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-ink transition-colors hover:bg-muted hover:text-brand-navy">
                  <I className="size-4 text-brand-ink-soft" /> {label}
                </Link>
              ))}
              {user.role === "admin" ? (
                <Link href="/admin" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-brand-yellow-soft px-3 text-sm font-bold text-brand-navy">
                  <ShieldCheck className="size-4" /> Painel admin
                </Link>
              ) : null}
              <form action={signOut}>
                <button type="submit" className="inline-flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-brand-red transition-colors hover:bg-brand-red/5">
                  <LogOut className="size-4" /> Sair
                </button>
              </form>
            </nav>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
