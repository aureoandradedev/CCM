import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound, PackageSearch, UserRound } from "lucide-react";

import { AuthPanel } from "@/components/account/auth-panel";
import { StatusBadge } from "@/components/account/order-detail";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { getMyOrders } from "@/lib/data/orders";
import { formatDateTime } from "@/lib/orders";
import { getCurrentUser } from "@/lib/supabase/auth";
import { formatBRL } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ next?: string; senha?: string; erro?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="container-ccm pt-4 md:pt-6">
        <Breadcrumbs items={[{ label: "Minha conta" }]} />
        <h1 className="mt-4 mb-6 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem]">Minha conta</h1>
        {sp.erro === "link" ? <p className="mb-4 rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">O link expirou ou é inválido. Peça um novo.</p> : null}
        <AuthPanel next={sp.next} />
      </div>
    );
  }

  const orders = await getMyOrders(5);
  return (
    <div className="space-y-6">
      {sp.senha === "ok" ? <p className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">Senha alterada com sucesso.</p> : null}
      {sp.erro === "admin" ? <p className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">Sua conta não tem acesso ao painel administrativo.</p> : null}
      <h1 className="font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy">Visão geral</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { href: "/conta/pedidos", icon: PackageSearch, title: "Meus pedidos", text: "Status, pagamento e itens de cada pedido." },
          { href: "/conta/dados", icon: UserRound, title: "Meus dados", text: "Nome, CPF/CNPJ e WhatsApp." },
          { href: "/conta/senha", icon: KeyRound, title: "Senha", text: "Trocar a senha de acesso." },
        ].map(({ href, icon: I, title, text }) => (
          <Link key={href} href={href} className="lift group rounded-2xl border border-brand-line bg-card p-5">
            <I className="size-6 text-brand-navy" />
            <p className="mt-3 font-heading text-lg font-bold text-brand-navy">{title}</p>
            <p className="mt-1 text-sm text-brand-ink-soft">{text}</p>
          </Link>
        ))}
      </div>

      <section className="rounded-2xl border border-brand-line bg-card">
        <header className="flex items-center justify-between border-b border-brand-line px-5 py-3">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Últimos pedidos</h2>
          <Button variant="link" className="px-0 text-brand-navy" render={<Link href="/conta/pedidos" />}>
            Ver todos <ArrowRight />
          </Button>
        </header>
        {orders.length ? (
          <ul className="divide-y divide-brand-line">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/conta/pedidos/${o.code}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-muted">
                  <span>
                    <span className="font-heading font-bold text-brand-navy">{o.code}</span>
                    <span className="ml-2 text-brand-ink-soft">{formatDateTime(o.created_at)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusBadge status={o.order_status} />
                    <span className="font-heading font-bold text-brand-navy tabular-nums">{formatBRL(o.total_centavos / 100)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-brand-ink-soft">Você ainda não fez pedidos.</p>
        )}
      </section>
    </div>
  );
}
