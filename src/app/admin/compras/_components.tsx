"use client";

import { useActionState } from "react";

import { useState, useTransition } from "react";

import { approveMatch, rejectMatch, selectOffer, publishProduct, processarPendencias, processarCatalogo, resolveException, createMasterFromItem, associateToMaster, rejectNormalizedItem, searchMasters, backfillApprovedOffers } from "./actions";
import type { ScopedItemReport } from "@/lib/admin/catalog-processor";

export function MatchActions({ itemId, masterProductId }: { itemId: string; masterProductId: string }) {
  const [, approve, approvePending] = useActionState(approveMatch, {});
  const [, reject, rejectPending] = useActionState(rejectMatch, {});
  const pending = approvePending || rejectPending;

  return (
    <div className="flex items-center gap-1.5">
      <form action={approve}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="masterProductId" value={masterProductId} />
        <button disabled={pending} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          Aprovar
        </button>
      </form>
      <form action={reject}>
        <input type="hidden" name="itemId" value={itemId} />
        <button disabled={pending} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
          Rejeitar
        </button>
      </form>
    </div>
  );
}

export function SelectOfferForm({ masterProductId, offerId }: { masterProductId: string; offerId: string }) {
  const [state, action, pending] = useActionState(selectOffer, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="masterProductId" value={masterProductId} />
      <input type="hidden" name="offerId" value={offerId} />
      <input name="note" placeholder="Observacao" className="w-28 rounded border border-brand-line px-2 py-1 text-xs" />
      <button disabled={pending} className="whitespace-nowrap rounded bg-brand-navy px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "…" : "Selecionar"}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state?.ok && <span className="text-xs text-green-600">{state.ok}</span>}
    </form>
  );
}

export function PublishProductForm({
  masterProductId,
  sourcingSelectionId,
  marginRuleId,
  expectedCostCentavos,
  expectedRetailCentavos,
  isRepublish,
  disabled,
}: {
  masterProductId: string;
  sourcingSelectionId: string;
  marginRuleId: string;
  expectedCostCentavos: number;
  expectedRetailCentavos: number;
  isRepublish: boolean;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(publishProduct, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="masterProductId" value={masterProductId} />
      <input type="hidden" name="sourcingSelectionId" value={sourcingSelectionId} />
      <input type="hidden" name="marginRuleId" value={marginRuleId} />
      <input type="hidden" name="expectedCostCentavos" value={expectedCostCentavos} />
      <input type="hidden" name="expectedRetailCentavos" value={expectedRetailCentavos} />
      <textarea
        name="note"
        placeholder="Observacao (opcional)"
        rows={2}
        className="w-full rounded border border-brand-line px-3 py-2 text-sm"
      />
      <button
        disabled={pending || disabled}
        className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {pending ? "Publicando…" : isRepublish ? "Republicar produto" : "Publicar produto"}
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}
    </form>
  );
}

// ─── Orquestrador ──────────────────────────────────────────────────────────

export function ProcessarPendenciasButton() {
  const [state, action, pending] = useActionState(processarPendencias, {});

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <button
          disabled={pending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Processando…" : "Processar pendências"}
        </button>
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">{state.ok}</p>}
    </div>
  );
}

export function BackfillOffersButton() {
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await backfillApprovedOffers();
      setResult(res.ok ?? res.error ?? "Sem resultado");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded border border-brand-line bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Criando ofertas…" : "Gerar ofertas pendentes"}
      </button>
      {result && <p className="text-sm text-brand-fg/70">{result}</p>}
    </div>
  );
}

// ─── Processamento scoped de catálogo ─────────────────────────────────

const REPORT_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  normalizado: "Normalizado",
  match_sugerido: "Match sugerido",
  revisao_manual: "Revisão manual",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

const REPORT_STATUS_CLS: Record<string, string> = {
  aprovado: "text-green-700",
  rejeitado: "text-red-600",
  match_sugerido: "text-blue-700",
  revisao_manual: "text-amber-700",
  normalizado: "text-gray-600",
  pendente: "text-gray-400",
};

export function ProcessarCatalogoButton({ catalogId }: { catalogId: string }) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string; report?: ScopedItemReport[] } | null>(null);
  const [showReport, setShowReport] = useState(false);

  async function handleClick() {
    setProcessing(true);
    setResult(null);
    try {
      const r = await processarCatalogo(catalogId);
      setResult({
        ok: r.ok,
        error: r.error,
        report: r.scopedResult?.item_report,
      });
      if (r.ok) setShowReport(true);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={processing}
        className="whitespace-nowrap rounded bg-brand-navy px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {processing ? "Processando…" : "Processar"}
      </button>
      {result?.error && <p className="mt-1 text-xs text-red-600">{result.error}</p>}
      {result?.ok && (
        <div className="mt-1">
          <p className="text-xs text-green-600">{result.ok}</p>
          {result.report && result.report.length > 0 && (
            <button
              type="button"
              onClick={() => setShowReport(!showReport)}
              className="mt-1 text-[10px] font-medium text-brand-navy underline"
            >
              {showReport ? "Ocultar relatório" : `Ver relatório (${result.report.length} itens)`}
            </button>
          )}
        </div>
      )}
      {showReport && result?.report && (
        <div className="mt-2 max-h-64 overflow-auto rounded border border-brand-line bg-white text-[11px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-line bg-gray-50 text-left text-[10px] font-bold uppercase text-gray-500">
                <th className="px-2 py-1">Nome</th>
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1">Antes</th>
                <th className="px-2 py-1">Depois</th>
                <th className="px-2 py-1">Conf.</th>
                <th className="px-2 py-1">Master</th>
                <th className="px-2 py-1">Oferta</th>
              </tr>
            </thead>
            <tbody>
              {result.report.map((r) => (
                <tr key={r.id} className="border-b border-brand-line last:border-0">
                  <td className="max-w-[120px] truncate px-2 py-1 font-medium">{r.name}</td>
                  <td className="px-2 py-1 text-gray-500">{r.supplier_sku ?? "—"}</td>
                  <td className={`px-2 py-1 ${REPORT_STATUS_CLS[r.before_status] ?? ""}`}>
                    {REPORT_STATUS_LABEL[r.before_status] ?? r.before_status}
                  </td>
                  <td className={`px-2 py-1 font-medium ${REPORT_STATUS_CLS[r.after_status] ?? ""}`}>
                    {REPORT_STATUS_LABEL[r.after_status] ?? r.after_status}
                  </td>
                  <td className="px-2 py-1 text-right">{r.match_confidence != null ? `${r.match_confidence}%` : "—"}</td>
                  <td className="max-w-[100px] truncate px-2 py-1 text-gray-500">{r.master_product_name ?? "—"}</td>
                  <td className="px-2 py-1 text-gray-500">{r.offer_action ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Exceções ──────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
};

const TYPE_LABELS: Record<string, string> = {
  review_match: "Identificação pendente",
  review_ranking: "Mais de um fornecedor possível",
  no_offer: "Sem oferta cadastrada",
  no_master_candidate: "Produto não identificado",
  source_changed: "Dados do fornecedor alterados",
  economy_opportunity: "Oportunidade de economia",
  stale_sourcing: "Fornecedor atual indisponível",
  stale_publication: "Produto publicado desatualizado",
  inactive_item: "Item desativado",
};

export function ExceptionBadge({ type, severity }: { type: string; severity: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_COLORS[severity] ?? "bg-gray-100 text-gray-700"}`}>
        {severity}
      </span>
      <span className="text-xs text-brand-fg/70">{TYPE_LABELS[type] ?? type}</span>
    </span>
  );
}

export function ResolveExceptionForm({ exceptionId }: { exceptionId: string }) {
  const [resolveState, resolveAction, resolvePending] = useActionState(resolveException, {});
  const [dismissState, dismissAction, dismissPending] = useActionState(resolveException, {});
  const pending = resolvePending || dismissPending;

  return (
    <div className="flex items-center gap-1.5">
      <form action={resolveAction} className="flex items-center gap-1">
        <input type="hidden" name="exceptionId" value={exceptionId} />
        <input type="hidden" name="resolution" value="resolved" />
        <input name="note" placeholder="Nota" className="w-24 rounded border border-brand-line px-2 py-0.5 text-xs" />
        <button disabled={pending} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {resolvePending ? "…" : "Resolver"}
        </button>
      </form>
      <form action={dismissAction}>
        <input type="hidden" name="exceptionId" value={exceptionId} />
        <input type="hidden" name="resolution" value="dismissed" />
        <button disabled={pending} className="rounded bg-gray-400 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-500 disabled:opacity-50">
          {dismissPending ? "…" : "Dispensar"}
        </button>
      </form>
      {resolveState?.error && <span className="text-xs text-red-600">{resolveState.error}</span>}
      {resolveState?.ok && <span className="text-xs text-green-600">{resolveState.ok}</span>}
      {dismissState?.error && <span className="text-xs text-red-600">{dismissState.error}</span>}
      {dismissState?.ok && <span className="text-xs text-green-600">{dismissState.ok}</span>}
    </div>
  );
}

// ─── Criar master a partir de item ────────────────────────────────────────

interface ItemData {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  ean: string | null;
  category_original: string | null;
  normalized_data: Record<string, unknown> | null;
  master_product_id?: string | null;
  master_product_name?: string | null;
}

export function CreateMasterForm({ item }: { item: ItemData }) {
  const [state, action, pending] = useActionState(createMasterFromItem, {});
  const nd = item.normalized_data ?? {};

  return (
    <form action={action} className="space-y-3 rounded-lg border border-brand-line bg-white p-4">
      <h3 className="text-sm font-semibold text-brand-fg">Criar novo produto</h3>
      <input type="hidden" name="itemId" value={item.id} />
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="col-span-2 block">
          <span className="font-medium text-brand-fg/70">Nome *</span>
          <input name="name" defaultValue={String(nd.name ?? item.name ?? "")} required className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Marca (slug)</span>
          <input name="brandSlug" defaultValue={String(nd.brand_slug ?? item.brand ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Marca (nome)</span>
          <input name="brandName" defaultValue={String(nd.brand_name ?? item.brand ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Modelo</span>
          <input name="model" defaultValue={String(nd.model ?? item.model ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">EAN</span>
          <input name="ean" defaultValue={String(item.ean ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Categoria (slug)</span>
          <input name="categorySlug" defaultValue={String(nd.category_slug ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Subcategoria (slug)</span>
          <input name="subcategorySlug" defaultValue={String(nd.subcategory_slug ?? "")} className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="font-medium text-brand-fg/70">Unidade</span>
          <input name="unit" defaultValue="un" className="mt-1 w-full rounded border border-brand-line px-2 py-1.5 text-sm" />
        </label>
      </div>
      <button disabled={pending} className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
        {pending ? "Criando…" : "Criar e confirmar"}
      </button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-green-600">{state.ok}</p>}
    </form>
  );
}

// ─── Associar a master existente ──────────────────────────────────────────

export function AssociateMasterForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(associateToMaster, {});
  const [results, setResults] = useState<{ id: string; name: string; brand_slug: string | null; model: string | null; ean: string | null }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [query, setQuery] = useState("");

  function handleSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    startSearch(async () => {
      const r = await searchMasters(q);
      setResults(r);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-line bg-white p-4">
      <h3 className="text-sm font-semibold text-brand-fg">Escolher produto existente</h3>
      <input
        type="text"
        placeholder="Buscar por nome, marca, modelo ou EAN…"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        className="w-full rounded border border-brand-line px-2 py-1.5 text-sm"
      />
      {searching && <p className="text-xs text-brand-fg/50">Buscando…</p>}
      {results.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelected(m.id)}
                className={`w-full rounded px-2 py-1 text-left transition ${selected === m.id ? "bg-blue-100 text-blue-800" : "hover:bg-gray-50"}`}
              >
                <span className="font-medium">{m.name}</span>
                {m.brand_slug && <span className="ml-1 text-brand-fg/50">({m.brand_slug})</span>}
                {m.model && <span className="ml-1 text-brand-fg/50">mod: {m.model}</span>}
                {m.ean && <span className="ml-1 text-brand-fg/50">EAN: {m.ean}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="masterProductId" value={selected} />
          <button disabled={pending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Vinculando…" : "Confirmar escolha"}
          </button>
          <button type="button" onClick={() => { setSelected(null); setResults([]); setQuery(""); }} className="text-xs text-brand-fg/50 hover:underline">
            Cancelar
          </button>
        </form>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-green-600">{state.ok}</p>}
    </div>
  );
}

// ─── Ações para item sem master ───────────────────────────────────────────

export function NoMasterActions({ item, reviewMode }: { item: ItemData; reviewMode?: boolean }) {
  const [mode, setMode] = useState<"idle" | "create" | "associate">("idle");
  const [rejectNormState, rejectNormAction, rejectNormPending] = useActionState(rejectNormalizedItem, {});
  const [rejectMatchState, rejectMatchAction, rejectMatchPending] = useActionState(rejectMatch, {});
  const [approveState, approveAction, approvePending] = useActionState(approveMatch, {});
  const activeRejectAction = reviewMode ? rejectMatchAction : rejectNormAction;
  const activeRejectState = reviewMode ? rejectMatchState : rejectNormState;
  const activeRejectPending = reviewMode ? rejectMatchPending : rejectNormPending;
  const pending = activeRejectPending || approvePending;

  if (mode === "create") return <CreateMasterForm item={item} />;
  if (mode === "associate") return <AssociateMasterForm itemId={item.id} />;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.master_product_id && (
        <form action={approveAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="masterProductId" value={item.master_product_id} />
          <button disabled={pending} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {approvePending ? "…" : "Confirmar produto"}
          </button>
        </form>
      )}
      {!item.master_product_id && (
        <button onClick={() => setMode("create")} disabled={pending} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          Criar novo produto
        </button>
      )}
      <button onClick={() => setMode("associate")} disabled={pending} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        Escolher outro produto
      </button>
      <form action={activeRejectAction}>
        <input type="hidden" name="itemId" value={item.id} />
        <button disabled={pending} className="rounded bg-gray-400 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-500 disabled:opacity-50">
          {activeRejectPending ? "…" : "Ignorar por enquanto"}
        </button>
      </form>
      {approveState?.error && <span className="text-xs text-red-600">{approveState.error}</span>}
      {approveState?.ok && <span className="text-xs text-green-600">{approveState.ok}</span>}
      {activeRejectState?.error && <span className="text-xs text-red-600">{activeRejectState.error}</span>}
      {activeRejectState?.ok && <span className="text-xs text-green-600">{activeRejectState.ok}</span>}
    </div>
  );
}
