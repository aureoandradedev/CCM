import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Package,
  Scale,
  Settings,
  ShoppingCart,
  Truck,
  Warehouse,
} from "lucide-react";

import { Kpi, NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminInventorySummary, adminPurchaseOrders, adminSuppliers, configured } from "@/lib/admin/data";
import { comprasDashboard } from "@/lib/admin/compras-data";
import { exceptionStats } from "@/lib/admin/orchestrator";
import { getAutomacaoWidget } from "@/lib/admin/automacao-data";
import { createClient } from "@/lib/supabase/server";
import { BackfillOffersButton } from "./_components";

export default async function ComprasDashboard() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();
  const [d, stats, autoWidget, orders, suppliers, inventory] = await Promise.all([
    comprasDashboard(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exceptionStats(sb as any),
    getAutomacaoWidget(),
    adminPurchaseOrders({ limit: 100 }),
    adminSuppliers(),
    adminInventorySummary(),
  ]);

  const pendenciaTotal = d.items.match_sugerido + d.items.revisao_manual + d.items.normalizado + (stats.total ?? 0);
  const produtosNaoIdentificados = d.items.match_sugerido + d.items.revisao_manual + d.items.normalizado;
  const excecoesAbertas = stats.total ?? 0;

  const poReady = orders.filter((o) => ["ready", "draft"].includes(o.status));
  const poBelowMin = orders.filter((o) => !o.minimum_met && o.status === "draft");
  const activeSuppliers = suppliers.filter((s) => s.active !== false);
  const suppliersWithIssue = suppliers.filter((s) => s.active === false);

  const autoOk = autoWidget.excecoesAbertas === 0;
  const lastRunStr = autoWidget.ultimaExecucao
    ? new Date(autoWidget.ultimaExecucao).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;

  return (
    <>
      <PageTitle title="Central de Compras" />

      {/* ── BLOCO 1: Precisa da sua atenção ───────────────────── */}
      {pendenciaTotal > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-6 shrink-0 text-amber-600" />
            <div className="flex-1">
              <h2 className="text-lg font-bold text-amber-900">Precisa da sua atenção</h2>
              <p className="mt-1 text-sm text-amber-800">
                <span className="text-2xl font-extrabold">{pendenciaTotal}</span> {pendenciaTotal === 1 ? "item precisa" : "itens precisam"} de atenção
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {produtosNaoIdentificados > 0 && (
                  <li>
                    <span className="font-semibold">{produtosNaoIdentificados}</span> {produtosNaoIdentificados === 1 ? "produto precisa ser identificado" : "produtos precisam ser identificados"}
                  </li>
                )}
                {excecoesAbertas > 0 && (
                  <li>
                    <span className="font-semibold">{excecoesAbertas}</span> {excecoesAbertas === 1 ? "exceção precisa ser verificada" : "exceções precisam ser verificadas"}
                  </li>
                )}
              </ul>
              <Link
                href="/admin/compras/pendencias"
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
              >
                Resolver pendências
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {pendenciaTotal === 0 && (
        <section className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 shrink-0 text-green-600" />
            <div>
              <h2 className="text-lg font-bold text-green-900">Tudo em dia</h2>
              <p className="text-sm text-green-800">Nenhuma pendência no momento.</p>
            </div>
          </div>
        </section>
      )}

      {/* ── BLOCO 2: Operação de Compras ─────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Operação de Compras</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pedidos de compra */}
        <Link
          href="/admin/compras/pedidos-compra"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <Package className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">Pedidos de compra</span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            {poReady.length > 0
              ? <><span className="text-lg font-extrabold text-brand-navy">{poReady.length}</span> {poReady.length === 1 ? "pedido pronto" : "pedidos prontos"}</>
              : <span className="text-brand-ink-soft">Nenhum pedido pendente</span>}
          </p>
          {poBelowMin.length > 0 && (
            <p className="mt-1 text-xs text-amber-600 font-medium">
              {poBelowMin.length} abaixo do pedido mínimo
            </p>
          )}
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver pedidos →
          </span>
        </Link>

        {/* Fornecedores */}
        <Link
          href="/admin/fornecedores"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <Truck className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">Fornecedores</span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            <span className="text-lg font-extrabold text-brand-navy">{activeSuppliers.length}</span> {activeSuppliers.length === 1 ? "fornecedor ativo" : "fornecedores ativos"}
          </p>
          {suppliersWithIssue.length > 0 && (
            <p className="mt-1 text-xs text-amber-600 font-medium">
              {suppliersWithIssue.length} com problema
            </p>
          )}
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver fornecedores →
          </span>
        </Link>

        {/* Catálogos */}
        <Link
          href="/admin/compras/catalogos"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <ClipboardList className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">Catálogos</span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            {d.catalogs.pending > 0
              ? <><span className="text-lg font-extrabold text-amber-600">{d.catalogs.pending}</span> aguardando processamento</>
              : <span className="text-brand-ink-soft">Todos processados</span>}
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">{d.catalogs.total} no total</p>
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver catálogos →
          </span>
        </Link>

        {/* Estoque CCM */}
        <Link
          href="/admin/compras/estoque"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <Warehouse className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">Estoque CCM</span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            <span className="text-lg font-extrabold text-brand-navy">{inventory.length}</span> {inventory.length === 1 ? "item em estoque" : "itens em estoque"}
          </p>
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver estoque →
          </span>
        </Link>
      </div>

      {/* ── BLOCO 3: Automação ──────────────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Automação</h2>
      <Link
        href="/admin/automacao"
        className="group mb-6 flex items-start gap-4 rounded-2xl border border-brand-line bg-card p-5 transition hover:shadow"
      >
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${autoOk ? "bg-green-50" : "bg-amber-50"}`}>
          <Bot className={`size-5 ${autoOk ? "text-green-600" : "text-amber-600"}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-brand-ink group-hover:text-brand-navy">
              {autoOk ? "Automação funcionando normalmente" : "Automação com pendências"}
            </h3>
            <span className={`inline-flex size-2.5 rounded-full ${autoOk ? "bg-green-500" : "bg-amber-500"}`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-soft">
            {lastRunStr && (
              <span>Última execução: <span className="font-medium text-brand-ink">{lastRunStr}</span></span>
            )}
            <span>{autoWidget.trocasAuto24h} {autoWidget.trocasAuto24h === 1 ? "troca de fornecedor" : "trocas de fornecedor"} (24h)</span>
            <span>{autoWidget.precosAuto24h} {autoWidget.precosAuto24h === 1 ? "alteração de preço" : "alterações de preço"} (24h)</span>
            {autoWidget.excecoesAbertas > 0 && (
              <span className="font-medium text-amber-600">{autoWidget.excecoesAbertas} {autoWidget.excecoesAbertas === 1 ? "exceção aberta" : "exceções abertas"}</span>
            )}
          </div>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-navy">
            Ver histórico da automação <ArrowRight className="size-3" />
          </span>
        </div>
      </Link>

      {/* ── BLOCO 4: Ferramentas ────────────────────────────── */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">Ferramentas</h2>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/admin/compras/catalogos", label: "Catálogos", icon: ClipboardList, desc: "Importar e processar" },
          { href: "/admin/compras/condicoes", label: "Condições comerciais", icon: ShoppingCart, desc: "Termos por fornecedor" },
          { href: "/admin/compras/pedidos-compra", label: "Pedidos de compra", icon: Package, desc: "Ciclos, mínimos, envio" },
          { href: "/admin/compras/estoque", label: "Estoque CCM", icon: Warehouse, desc: "Sobras e inventário" },
          { href: "/admin/compras/precos", label: "Preços e fornecedores", icon: DollarSign, desc: "Preços e seleção" },
          { href: "/admin/compras/configuracoes-venda", label: "Configuração de venda", icon: Settings, desc: "Seções, limites, regras" },
        ].map((s) => (
          <Link key={s.href} href={s.href} className="group/card flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow">
            <s.icon className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
            <div>
              <p className="font-medium text-brand-ink group-hover/card:text-brand-navy">{s.label}</p>
              <p className="text-sm text-brand-ink-soft">{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Ferramentas avançadas */}
      <details className="group">
        <summary className="mb-2 cursor-pointer text-sm font-semibold text-brand-ink-soft hover:text-brand-navy">
          Ferramentas avançadas
        </summary>
        <div className="space-y-3">
          <div className="rounded-2xl border border-brand-line bg-card p-4">
            <h4 className="mb-1 text-sm font-semibold text-brand-ink">Manutenção</h4>
            <p className="mb-3 text-xs text-brand-ink-soft">
              Gera ofertas automaticamente para itens aprovados que ainda não possuem oferta cadastrada.
            </p>
            <BackfillOffersButton />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/admin/compras/matching"
              className="group/card flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
            >
              <Scale className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
              <div>
                <p className="font-medium text-brand-ink group-hover/card:text-brand-navy">Fila de identificação</p>
                <p className="text-sm text-brand-ink-soft">{d.items.match_sugerido + d.items.revisao_manual} item(ns) aguardando</p>
              </div>
            </Link>
            <Link
              href="/admin/compras/automacao"
              className="group/card flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
            >
              <Bot className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
              <div>
                <p className="font-medium text-brand-ink group-hover/card:text-brand-navy">Automação detalhada</p>
                <p className="text-sm text-brand-ink-soft">{stats.total} exceção(ões) aberta(s)</p>
              </div>
            </Link>
          </div>
        </div>
      </details>
    </>
  );
}
