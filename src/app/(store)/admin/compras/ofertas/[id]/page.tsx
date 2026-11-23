import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { Card, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { offerDetail, publishPreview } from "@/lib/admin/compras-data";
import { SelectOfferForm, PublishProductForm } from "../../_components";
import { formatBRL } from "@/lib/utils/format";

function flagBadge(flag: string) {
  const map: Record<string, { label: string; cls: string }> = {
    out_of_stock: { label: "Sem estoque", cls: "bg-red-100 text-red-800" },
    missing_cost: { label: "Sem custo", cls: "bg-red-100 text-red-800" },
    missing_lead_time: { label: "Prazo ausente", cls: "bg-amber-100 text-amber-800" },
    price_outlier: { label: "Preco outlier", cls: "bg-orange-100 text-orange-800" },
    low_stock: { label: "Estoque baixo", cls: "bg-amber-100 text-amber-800" },
    ambiguous_rank: { label: "Ambiguo", cls: "bg-yellow-100 text-yellow-800" },
  };
  const m = map[flag] ?? { label: flag, cls: "bg-gray-100 text-gray-600" };
  return (
    <span key={flag} className={`mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default async function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!configured()) return <NotConfigured />;
  const { product, offers, ranking, currentSelection, selectionHistory } = await offerDetail(id);
  if (!product) notFound();
  const pub = currentSelection ? await publishPreview(id) : null;

  const prod = product as Record<string, unknown>;

  return (
    <>
      <PageTitle
        title={prod.name as string}
        subtitle={[prod.brand_name, prod.ean, prod.model].filter(Boolean).join(" · ")}
      >
        <Link href="/admin/compras/ofertas" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
      </PageTitle>

      <Card className="mb-6">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-brand-ink-soft">Categoria:</span> {(prod.category_slug as string) ?? "—"}
          </div>
          <div>
            <span className="text-brand-ink-soft">Unidade:</span> {(prod.unit as string) ?? "un"}
          </div>
          <div>
            <span className="text-brand-ink-soft">Ranking:</span>{" "}
            {ranking?.ambiguous ? (
              <span className="font-medium text-amber-600">Ambiguo — decisao manual necessaria</span>
            ) : ranking?.recommended_offer_id ? (
              <span className="font-medium text-green-600">Recomendacao clara</span>
            ) : (
              <span className="text-brand-ink-soft">Sem ofertas elegiveis</span>
            )}
          </div>
        </div>
        {currentSelection && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-medium text-blue-800">Oferta selecionada</span>
            <span className="text-blue-700">
              {" — "}score {currentSelection.score?.toFixed(1) ?? "—"}
              {currentSelection.ambiguous && " (ranking ambiguo)"}
              {currentSelection.note && ` — ${currentSelection.note}`}
              {" — "}em {new Date(currentSelection.selected_at).toLocaleDateString("pt-BR")}
            </span>
          </div>
        )}
      </Card>

      {offers.length === 0 ? (
        <p className="text-sm text-brand-ink-soft">Nenhuma oferta ativa para este produto.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Fornecedor</Th>
              <Th className="text-right">Custo</Th>
              <Th className="text-right">Estoque</Th>
              <Th className="text-right">Prazo</Th>
              <Th className="text-right">Score</Th>
              <Th>Flags</Th>
              <Th>Acao</Th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const ranked = ranking?.offers.find((ro) => ro.supplier_offer_id === o.id);
              const isRecommended = ranking?.recommended_offer_id === o.id;
              const isSelected = currentSelection?.supplier_offer_id === o.id;

              return (
                <tr key={o.id} className={isSelected ? "bg-blue-50" : isRecommended ? "bg-green-50" : ""}>
                  <Td className="font-medium">{ranked?.position ?? "—"}</Td>
                  <Td>
                    {o.supplier_name}
                    {isSelected && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">Selecionada</span>
                    )}
                    {isRecommended && !isSelected && (
                      <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">Recomendada</span>
                    )}
                  </Td>
                  <Td className="text-right font-mono text-sm">{formatBRL(o.cost_centavos / 100)}</Td>
                  <Td className="text-right">{o.stock ?? "—"}</Td>
                  <Td className="text-right">{o.lead_time_days >= 0 ? `${o.lead_time_days}d` : "—"}</Td>
                  <Td className="text-right font-mono text-sm">{ranked?.score_total?.toFixed(1) ?? "—"}</Td>
                  <Td>{ranked?.flags.length ? ranked.flags.map((f) => flagBadge(f)) : "—"}</Td>
                  <Td>
                    {o.status === "ativa" && <SelectOfferForm masterProductId={id} offerId={o.id} />}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {ranking && ranking.offers.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Detalhamento de scores</h3>
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th className="text-right">Custo (60%)</Th>
                <Th className="text-right">Estoque (20%)</Th>
                <Th className="text-right">Prazo (20%)</Th>
                <Th className="text-right">Total</Th>
                <Th>Razoes</Th>
              </tr>
            </thead>
            <tbody>
              {ranking.offers.map((ro) => {
                const o = offers.find((x) => x.id === ro.supplier_offer_id);
                return (
                  <tr key={ro.supplier_offer_id}>
                    <Td>{o?.supplier_name ?? ro.supplier_id}</Td>
                    <Td className="text-right font-mono text-xs">{ro.score_cost.toFixed(1)}</Td>
                    <Td className="text-right font-mono text-xs">{ro.score_stock.toFixed(1)}</Td>
                    <Td className="text-right font-mono text-xs">{ro.score_lead_time.toFixed(1)}</Td>
                    <Td className="text-right font-mono text-sm font-medium">{ro.score_total.toFixed(1)}</Td>
                    <Td className="max-w-[300px] text-xs text-brand-ink-soft">{ro.reasons.join("; ") || "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {selectionHistory.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">Historico de selecoes</h3>
          <Table>
            <thead>
              <tr>
                <Th>Oferta</Th>
                <Th>Score</Th>
                <Th>Observacao</Th>
                <Th>Selecionada em</Th>
                <Th>Substituida em</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {selectionHistory.map((h) => {
                const offer = offers.find((o) => o.id === h.supplier_offer_id);
                const isActive = h.replaced_at == null;
                return (
                  <tr key={h.id} className={isActive ? "bg-blue-50" : ""}>
                    <Td className="text-xs font-medium">{offer?.supplier_name ?? h.supplier_offer_id.slice(0, 8)}</Td>
                    <Td className="font-mono text-xs">{h.score?.toFixed(1) ?? "—"}{h.ambiguous ? " (amb.)" : ""}</Td>
                    <Td className="max-w-[200px] truncate text-xs">{h.note ?? "—"}</Td>
                    <Td className="text-xs">{new Date(h.selected_at).toLocaleDateString("pt-BR")}</Td>
                    <Td className="text-xs">{h.replaced_at ? new Date(h.replaced_at).toLocaleDateString("pt-BR") : "—"}</Td>
                    <Td>
                      {isActive ? (
                        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Atual</span>
                      ) : (
                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Substituida</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {pub && !("error" in pub && !pub.pricing) && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-brand-ink-soft">Publicacao CCM</h3>
          {"error" in pub && <p className="mb-3 text-sm text-red-600">{pub.error}</p>}

          {pub.pricing && (
            <Card className="mb-4">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="text-brand-ink-soft">Custo:</span>{" "}
                  <span className="font-mono font-medium">{formatBRL(pub.pricing.cost_centavos / 100)}</span>
                </div>
                <div>
                  <span className="text-brand-ink-soft">Margem:</span>{" "}
                  <span className="font-mono font-medium">{pub.pricing.margin_pct}%</span>
                  <span className="ml-1 text-xs text-brand-ink-soft">({pub.pricing.source})</span>
                </div>
                <div>
                  <span className="text-brand-ink-soft">Preco:</span>{" "}
                  <span className="font-mono font-medium text-green-700">{formatBRL(pub.pricing.retail_price)}</span>
                  {pub.pricing.rounding !== "none" && (
                    <span className="ml-1 text-xs text-brand-ink-soft">(arred. {pub.pricing.rounding})</span>
                  )}
                </div>
                <div>
                  <span className="text-brand-ink-soft">Estoque:</span>{" "}
                  <span className="font-medium">{pub.offer.stock ?? "sob consulta"}</span>
                </div>
              </div>
              {pub.existingProduct && (
                <div className="mt-2 text-xs text-brand-ink-soft">
                  Publicado anteriormente: {formatBRL(pub.existingProduct.retail_price)}
                  {" — "}status: {pub.existingProduct.publish_status}
                  {pub.isStale && <span className="ml-1 font-medium text-amber-600">(selecao desatualizada)</span>}
                </div>
              )}
            </Card>
          )}

          {pub.problems.length > 0 && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-sm font-medium text-red-800">Problemas que impedem a publicacao:</p>
              <ul className="list-inside list-disc text-sm text-red-700">
                {pub.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          <PublishProductForm
            masterProductId={id}
            sourcingSelectionId={pub.selection.id}
            marginRuleId={pub.pricing?.margin_rule_id ?? ""}
            expectedCostCentavos={pub.offer.cost_centavos}
            expectedRetailCentavos={pub.pricing?.rounded_price_centavos ?? 0}
            isRepublish={pub.isRepublish ?? false}
            disabled={pub.problems.length > 0 || !pub.pricing}
          />
        </div>
      )}

      {pub && "error" in pub && !pub.pricing && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-brand-ink-soft">Publicacao CCM</h3>
          <p className="text-sm text-brand-ink-soft">{pub.error}</p>
        </div>
      )}
    </>
  );
}
