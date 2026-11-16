import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Calendar, DollarSign } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { cn } from "@/lib/utils";
import { getProductDrilldownData, type SupplierHistoryEvent } from "@/lib/admin/supplier-bi-data";

function fmt(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ProductDrilldownPage({
  params,
}: {
  params: Promise<{ id: string; masterProductId: string }>;
}) {
  if (!configured()) return <NotConfigured />;
  const { id: supplierId, masterProductId } = await params;
  const data = await getProductDrilldownData(supplierId, masterProductId);
  if (!data || !data.masterProduct) notFound();

  const { masterProduct, offer, supplierSku, supplierName, sourcingStatus, rankPosition, rankScore, competitors, salesKpis, sales, history } = data;

  const statusBadge = {
    atual: { label: "Sourcing atual", cls: "bg-green-100 text-green-800" },
    alternativa: { label: "Alternativa", cls: "bg-muted text-brand-ink-soft" },
    inelegivel: { label: "Inelegível", cls: "bg-red-100 text-red-700" },
  }[sourcingStatus];

  return (
    <>
      <Link
        href={`/admin/fornecedores/${supplierId}?tab=produtos`}
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> {supplierName} — Produtos
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        {masterProduct.images[0] ? (
          <img src={masterProduct.images[0]} alt="" className="size-20 rounded-xl border border-brand-line object-cover" />
        ) : (
          <div className="size-20 rounded-xl border border-brand-line bg-muted" />
        )}
        <div>
          <PageTitle title={masterProduct.name} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-ink-soft">
            {supplierSku && <span>SKU: {supplierSku}</span>}
            {masterProduct.ean && <span>EAN: {masterProduct.ean}</span>}
            {offer && <span>Oferta: {offer.status}</span>}
            <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", statusBadge.cls)}>
              {statusBadge.label}
            </span>
          </div>
        </div>
      </div>

      {/* ── Situação atual ────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Situação atual</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard label="Custo" value={offer ? fmt(offer.cost_centavos) : "—"} />
          <InfoCard label="Estoque" value={offer?.stock != null ? String(offer.stock) : "—"} tone={offer?.stock != null && offer.stock <= 0 ? "red" : undefined} />
          <InfoCard label="Prazo" value={offer ? `${offer.lead_time_days} dia(s)` : "—"} />
          <InfoCard label="Posição" value={rankPosition ? `#${rankPosition} · ${rankScore?.toFixed(1) ?? "—"} pts` : "Sem classificação"} />
        </div>
      </section>

      {/* ── Comparação concorrentes ───────────────────────────────── */}
      {competitors.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Comparação de fornecedores</h2>
          <div className="overflow-x-auto rounded-xl border border-brand-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Fornecedor</th>
                  <th className="px-4 py-2">Custo</th>
                  <th className="px-4 py-2">Estoque</th>
                  <th className="px-4 py-2">Prazo</th>
                  <th className="px-4 py-2">Score</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => {
                  const isMe = c.supplierId === supplierId;
                  return (
                    <tr
                      key={c.supplierId}
                      className={cn(
                        "border-b border-brand-line last:border-0",
                        isMe && "bg-brand-navy/5 font-semibold",
                        c.isCurrent && "ring-1 ring-inset ring-green-400",
                      )}
                    >
                      <td className="px-4 py-2 tabular-nums">{c.position ?? "—"}</td>
                      <td className="px-4 py-2">
                        {isMe ? (
                          <span className="text-brand-navy">{c.supplierName} (este)</span>
                        ) : (
                          <Link href={`/admin/fornecedores/${c.supplierId}?tab=produtos`} className="text-brand-navy hover:underline">
                            {c.supplierName}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{fmt(c.costCentavos)}</td>
                      <td className="px-4 py-2 tabular-nums">{c.stock ?? "—"}</td>
                      <td className="px-4 py-2 tabular-nums">{c.leadTimeDays}d</td>
                      <td className="px-4 py-2 tabular-nums">{c.score?.toFixed(1) ?? "—"}</td>
                      <td className="px-4 py-2">
                        {c.isCurrent ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-green-700">Principal</span>
                        ) : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold text-brand-ink-soft">Alternativa</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── KPIs de vendas ────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Vendas atribuídas a {supplierName}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Unidades" value={String(salesKpis.unidades)} />
          <KpiCard label="Faturamento" value={fmt(salesKpis.faturamento)} />
          <KpiCard label="Pedidos" value={String(salesKpis.pedidos)} />
          <KpiCard label="Ticket médio" value={fmt(salesKpis.ticketMedio)} />
        </div>
        {salesKpis.margemBruta !== 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <KpiCard label="Custo total (CMV)" value={fmt(salesKpis.custoTotal)} />
            <KpiCard label="Margem bruta" value={fmt(salesKpis.margemBruta)} tone={salesKpis.margemBruta > 0 ? "green" : "red"} />
            <KpiCard
              label="Última venda"
              value={salesKpis.ultimaVenda ? new Date(salesKpis.ultimaVenda).toLocaleDateString("pt-BR") : "Nenhuma"}
            />
          </div>
        )}
        {salesKpis.itensNaoRastreaveis > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mb-0.5 mr-1 inline size-3.5" />
            {salesKpis.itensNaoRastreaveis} item(ns) sem snapshot de custo. Margem calculada apenas para itens com rastreabilidade.
          </div>
        )}
      </section>

      {/* ── Tabela de vendas ──────────────────────────────────────── */}
      {sales.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Detalhamento de vendas</h2>
          <div className="overflow-x-auto rounded-xl border border-brand-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
                  <th className="px-4 py-2">Pedido</th>
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2 text-right">Qtd</th>
                  <th className="px-4 py-2 text-right">Preço un.</th>
                  <th className="px-4 py-2 text-right">Custo un.</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Margem</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={i} className="border-b border-brand-line last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link href={`/admin/pedidos/${s.orderCode}`} className="font-medium text-brand-navy hover:underline">
                        {s.orderCode}
                      </Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-brand-ink-soft">
                      {new Date(s.orderDate).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.qty}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(s.unitPriceCentavos)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.supplierCostCentavos != null ? fmt(s.supplierCostCentavos) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(s.lineCentavos)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.margemCentavos != null ? fmt(s.margemCentavos) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Histórico ─────────────────────────────────────────────── */}
      {history.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Histórico</h2>
          <div className="space-y-2">
            {history.map((e) => (
              <HistoryRow key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function InfoCard({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-brand-ink-soft">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", tone === "red" ? "text-red-600" : "text-brand-ink")}>{value}</p>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const tones = { green: "text-green-600", red: "text-red-600" };
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">{label}</p>
      <p className={cn("mt-1 font-heading text-xl font-extrabold tabular-nums", tone ? tones[tone] : "text-brand-navy")}>{value}</p>
    </div>
  );
}

function HistoryRow({ event: e }: { event: SupplierHistoryEvent }) {
  return (
    <div className="flex gap-3 rounded-xl border border-brand-line bg-card p-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        {e.type === "troca_fornecedor" ? <ArrowRightLeft className="size-4 text-blue-600" /> :
          e.type === "alteracao_preco" ? <DollarSign className="size-4 text-green-600" /> :
          e.type === "excecao_detectada" ? <AlertTriangle className="size-4 text-amber-600" /> :
          <Calendar className="size-4 text-brand-ink-soft" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-ink">{e.title}</p>
        {e.description && <p className="mt-0.5 text-xs text-brand-ink-soft">{e.description}</p>}
      </div>
      <time className="shrink-0 text-[0.65rem] text-brand-ink-soft">
        {new Date(e.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
      </time>
    </div>
  );
}
