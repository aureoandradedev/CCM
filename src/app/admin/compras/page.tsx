import Link from "next/link";
import { Bot, ClipboardList, DollarSign, GitCompare, Package, Scale, Settings, ShoppingCart, Warehouse } from "lucide-react";

import { Kpi, NotConfigured, PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { comprasDashboard } from "@/lib/admin/compras-data";
import { exceptionStats } from "@/lib/admin/orchestrator";
import { createClient } from "@/lib/supabase/server";

export default async function ComprasDashboard() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();
  const [d, stats] = await Promise.all([
    comprasDashboard(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exceptionStats(sb as any),
  ]);

  const sections = [
    { href: "/admin/compras/catalogos", label: "Fila de catalogos", icon: ClipboardList, desc: `${d.catalogs.pending} pendente(s) de ${d.catalogs.total}` },
    { href: "/admin/compras/matching", label: "Revisao de matching", icon: GitCompare, desc: `${d.items.match_sugerido + d.items.revisao_manual} item(ns) aguardando` },
    { href: "/admin/compras/ofertas", label: "Comparacao de ofertas", icon: Scale, desc: `${d.offers.total} produto(s) com oferta` },
    { href: "/admin/compras/automacao", label: "Automacao do comprador", icon: Bot, desc: `${stats.total} excecao(oes) aberta(s)` },
    { href: "/admin/compras/condicoes", label: "Condições comerciais", icon: ShoppingCart, desc: "Termos por fornecedor (R1.1)" },
    { href: "/admin/compras/pedidos-compra", label: "Pedidos de compra", icon: Package, desc: "Ciclos, mínimos, envio (R4)" },
    { href: "/admin/compras/estoque", label: "Estoque CCM", icon: Warehouse, desc: "Sobras e inventário (R3)" },
    { href: "/admin/compras/precos", label: "Preços e fornecedores", icon: DollarSign, desc: "Automação de preço e troca (R5, R6)" },
    { href: "/admin/compras/configuracoes-venda", label: "Config. de venda", icon: Settings, desc: "Seções, limites, flags (R3.2, R5.2)" },
  ];

  return (
    <>
      <PageTitle title="Central de Compras" subtitle="Visao operacional do pipeline de abastecimento" />

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Catalogos</h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Kpi label="Total de catalogos" value={String(d.catalogs.total)} />
        <Kpi label="Pendentes" value={String(d.catalogs.pending)} tone={d.catalogs.pending > 0 ? "yellow" : "slate"} />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Itens de catalogo</h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Pendentes" value={String(d.items.pendente)} tone={d.items.pendente > 0 ? "yellow" : "slate"} />
        <Kpi label="Normalizados" value={String(d.items.normalizado)} />
        <Kpi label="Match sugerido" value={String(d.items.match_sugerido)} tone={d.items.match_sugerido > 0 ? "yellow" : "slate"} />
        <Kpi label="Revisao manual" value={String(d.items.revisao_manual)} tone={d.items.revisao_manual > 0 ? "red" : "slate"} />
        <Kpi label="Aprovados" value={String(d.items.aprovado)} tone="green" />
        <Kpi label="Rejeitados" value={String(d.items.rejeitado)} />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Ofertas e sourcing</h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Produtos com oferta" value={String(d.offers.total)} />
        <Kpi label="Multiplas ofertas" value={String(d.offers.multiOffer)} />
        <Kpi label="Recomendacao clara" value={String(d.offers.clear)} tone="green" />
        <Kpi label="Rankings ambiguos" value={String(d.offers.ambiguous)} tone={d.offers.ambiguous > 0 ? "yellow" : "slate"} />
        <Kpi label="Selecionados" value={String(d.offers.selected)} tone="green" />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Operacoes</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="group flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow">
            <s.icon className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
            <div>
              <p className="font-medium text-brand-ink group-hover:text-brand-navy">{s.label}</p>
              <p className="text-sm text-brand-ink-soft">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
