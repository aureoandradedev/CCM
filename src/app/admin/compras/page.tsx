import Link from "next/link";
import { Bot, ClipboardList, DollarSign, GitCompare, Package, Scale, Settings, ShoppingCart, Warehouse } from "lucide-react";

import { Kpi, NotConfigured, PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { comprasDashboard } from "@/lib/admin/compras-data";
import { exceptionStats } from "@/lib/admin/orchestrator";
import { createClient } from "@/lib/supabase/server";
import { BackfillOffersButton } from "./_components";

export default async function ComprasDashboard() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();
  const [d, stats] = await Promise.all([
    comprasDashboard(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exceptionStats(sb as any),
  ]);

  const pendenciaTotal = d.items.match_sugerido + d.items.revisao_manual + d.items.normalizado + (stats.total ?? 0);
  const prontosParaConfirmar = d.offers.clear - d.offers.selected;

  const advancedSections = [
    { href: "/admin/compras/catalogos", label: "Catálogos", icon: ClipboardList, desc: `${d.catalogs.pending} pendente(s) de ${d.catalogs.total}` },
    { href: "/admin/compras/matching", label: "Fila de matching", icon: GitCompare, desc: `${d.items.match_sugerido + d.items.revisao_manual} item(ns) aguardando` },
    { href: "/admin/compras/automacao", label: "Automação", icon: Bot, desc: `${stats.total} exceção(ões) aberta(s)` },
    { href: "/admin/compras/condicoes", label: "Condições comerciais", icon: ShoppingCart, desc: "Termos por fornecedor" },
    { href: "/admin/compras/pedidos-compra", label: "Pedidos de compra", icon: Package, desc: "Ciclos, mínimos, envio" },
    { href: "/admin/compras/estoque", label: "Estoque CCM", icon: Warehouse, desc: "Sobras e inventário" },
    { href: "/admin/compras/precos", label: "Preços e fornecedores", icon: DollarSign, desc: "Automação de preço e troca" },
    { href: "/admin/compras/configuracoes-venda", label: "Config. de venda", icon: Settings, desc: "Seções, limites, flags" },
  ];

  return (
    <>
      <PageTitle title="Central de Compras" subtitle="Visão operacional do pipeline de abastecimento" />

      {/* Próximas ações */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Link
          href="/admin/compras/pendencias"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <span className="text-2xl font-bold text-amber-600">{pendenciaTotal}</span>
          <span className="text-sm font-medium text-brand-fg group-hover:text-brand-navy">
            Pendências para resolver
          </span>
          <span className="mt-1 text-xs text-brand-fg/50">
            {d.items.match_sugerido + d.items.revisao_manual} matching + {d.items.normalizado} sem master + {stats.total ?? 0} exceções
          </span>
        </Link>
        <Link
          href="/admin/compras/ofertas"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <span className="text-2xl font-bold text-blue-600">{prontosParaConfirmar > 0 ? prontosParaConfirmar : 0}</span>
          <span className="text-sm font-medium text-brand-fg group-hover:text-brand-navy">
            Prontos para confirmar fornecedor
          </span>
          <span className="mt-1 text-xs text-brand-fg/50">
            {d.offers.total} produto(s) com oferta, {d.offers.selected} já selecionado(s)
          </span>
        </Link>
        <Link
          href="/admin/compras/precos"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <span className="text-2xl font-bold text-green-600">{d.offers.selected}</span>
          <span className="text-sm font-medium text-brand-fg group-hover:text-brand-navy">
            Fornecedores confirmados
          </span>
          <span className="mt-1 text-xs text-brand-fg/50">
            {d.offers.ambiguous} ranking(s) ambíguo(s)
          </span>
        </Link>
      </div>

      {/* KPIs resumo */}
      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Resumo do pipeline</h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Catálogos pendentes" value={String(d.catalogs.pending)} tone={d.catalogs.pending > 0 ? "yellow" : "slate"} />
        <Kpi label="Itens pendentes" value={String(d.items.pendente)} tone={d.items.pendente > 0 ? "yellow" : "slate"} />
        <Kpi label="Aprovados" value={String(d.items.aprovado)} tone="green" />
        <Kpi label="Ofertas ativas" value={String(d.offers.total)} />
        <Kpi label="Recomendação clara" value={String(d.offers.clear)} tone="green" />
        <Kpi label="Selecionados" value={String(d.offers.selected)} tone="green" />
      </div>

      {/* Ferramentas avançadas */}
      <details className="group">
        <summary className="mb-2 cursor-pointer text-sm font-semibold text-brand-ink-soft hover:text-brand-navy">
          Ferramentas avançadas <span className="text-xs font-normal text-brand-fg/40">({advancedSections.length + 1})</span>
        </summary>
        <div className="mb-3">
          <BackfillOffersButton />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {advancedSections.map((s) => (
            <Link key={s.href} href={s.href} className="group/card flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow">
              <s.icon className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
              <div>
                <p className="font-medium text-brand-ink group-hover/card:text-brand-navy">{s.label}</p>
                <p className="text-sm text-brand-ink-soft">{s.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </details>
    </>
  );
}
