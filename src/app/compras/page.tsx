import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Package,
  Scale,
  Truck,
} from "lucide-react";

import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminPurchaseOrders, adminSuppliers, configured } from "@/lib/admin/data";
import { comprasDashboard } from "@/lib/admin/compras-data";
import { exceptionStats } from "@/lib/admin/orchestrator";
import { createClient } from "@/lib/supabase/server";

export default async function ComprasDashboardPage() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();
  const [d, stats, orders, suppliers] = await Promise.all([
    comprasDashboard(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exceptionStats(sb as any),
    adminPurchaseOrders({ limit: 100 }),
    adminSuppliers(),
  ]);

  const pendenciaTotal =
    d.items.match_sugerido +
    d.items.revisao_manual +
    d.items.normalizado +
    (stats.total ?? 0);
  const produtosNaoIdentificados =
    d.items.match_sugerido + d.items.revisao_manual + d.items.normalizado;
  const excecoesAbertas = stats.total ?? 0;

  const poReady = orders.filter((o) =>
    ["ready", "draft"].includes(o.status),
  );
  const poBelowMin = orders.filter(
    (o) => !o.minimum_met && o.status === "draft",
  );
  const activeSuppliers = suppliers.filter((s) => s.active !== false);
  const suppliersWithIssue = suppliers.filter((s) => s.active === false);

  return (
    <>
      <PageTitle title="Painel de Compras" />

      {/* Precisa da sua atenção */}
      {pendenciaTotal > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-6 shrink-0 text-amber-600" />
            <div className="flex-1">
              <h2 className="text-lg font-bold text-amber-900">
                Precisa da sua atenção
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                <span className="text-2xl font-extrabold">
                  {pendenciaTotal}
                </span>{" "}
                {pendenciaTotal === 1
                  ? "item precisa"
                  : "itens precisam"}{" "}
                de atenção
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {produtosNaoIdentificados > 0 && (
                  <li>
                    <span className="font-semibold">
                      {produtosNaoIdentificados}
                    </span>{" "}
                    {produtosNaoIdentificados === 1
                      ? "produto precisa ser identificado"
                      : "produtos precisam ser identificados"}
                  </li>
                )}
                {excecoesAbertas > 0 && (
                  <li>
                    <span className="font-semibold">{excecoesAbertas}</span>{" "}
                    {excecoesAbertas === 1
                      ? "exceção precisa ser verificada"
                      : "exceções precisam ser verificadas"}
                  </li>
                )}
              </ul>
              <Link
                href="/compras/pendencias"
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
              <p className="text-sm text-green-800">
                Nenhuma pendência no momento.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Operação de Compras */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">
        Operação de Compras
      </h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/compras/pedidos"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <Package className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">
              Pedidos de compra
            </span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            {poReady.length > 0 ? (
              <>
                <span className="text-lg font-extrabold text-brand-navy">
                  {poReady.length}
                </span>{" "}
                {poReady.length === 1 ? "pedido pronto" : "pedidos prontos"}
              </>
            ) : (
              <span className="text-brand-ink-soft">
                Nenhum pedido pendente
              </span>
            )}
          </p>
          {poBelowMin.length > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-600">
              {poBelowMin.length} abaixo do pedido mínimo
            </p>
          )}
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver pedidos →
          </span>
        </Link>

        <Link
          href="/compras/fornecedores"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <Truck className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">
              Fornecedores
            </span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            <span className="text-lg font-extrabold text-brand-navy">
              {activeSuppliers.length}
            </span>{" "}
            {activeSuppliers.length === 1
              ? "fornecedor ativo"
              : "fornecedores ativos"}
          </p>
          {suppliersWithIssue.length > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-600">
              {suppliersWithIssue.length} com problema
            </p>
          )}
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver fornecedores →
          </span>
        </Link>

        <Link
          href="/compras/catalogos"
          className="group flex flex-col rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <div className="mb-2 flex items-center gap-2">
            <ClipboardList className="size-5 text-brand-navy" />
            <span className="text-sm font-bold text-brand-ink">Catálogos</span>
          </div>
          <p className="text-sm text-brand-ink-soft">
            {d.catalogs.pending > 0 ? (
              <>
                <span className="text-lg font-extrabold text-amber-600">
                  {d.catalogs.pending}
                </span>{" "}
                aguardando processamento
              </>
            ) : (
              <span className="text-brand-ink-soft">Todos processados</span>
            )}
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">
            {d.catalogs.total} no total
          </p>
          <span className="mt-auto pt-2 text-xs font-semibold text-brand-navy opacity-0 transition-opacity group-hover:opacity-100">
            Ver catálogos →
          </span>
        </Link>
      </div>

      {/* Ferramentas */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-ink-soft">
        Ferramentas
      </h2>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Link
          href="/compras/matching"
          className="group/card flex items-start gap-3 rounded-2xl border border-brand-line bg-card p-4 transition hover:shadow"
        >
          <Scale className="mt-0.5 size-5 shrink-0 text-brand-ink-soft" />
          <div>
            <p className="font-medium text-brand-ink group-hover/card:text-brand-navy">
              Fila de identificação
            </p>
            <p className="text-sm text-brand-ink-soft">
              {d.items.match_sugerido + d.items.revisao_manual} item(ns)
              aguardando
            </p>
          </div>
        </Link>
        <div className="rounded-2xl border border-brand-line bg-card p-4">
          <h4 className="mb-1 text-sm font-semibold text-brand-ink">
            Exceções
          </h4>
          <p className="mb-3 text-xs text-brand-ink-soft">
            Problemas reportados no recebimento que precisam de ação.
          </p>
          <Link
            href="/compras/excecoes"
            className="text-sm font-semibold text-brand-navy hover:underline"
          >
            Ver exceções →
          </Link>
        </div>
      </div>
    </>
  );
}
