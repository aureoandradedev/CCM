"use client";

import { useActionState } from "react";

import { useState, useTransition } from "react";

import { approveMatch, rejectMatch, selectOffer, publishProduct, processarPendencias, resolveException, createMasterFromItem, associateToMaster, rejectNormalizedItem, searchMasters } from "./actions";

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

// ─── Exceções ──────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
};

const TYPE_LABELS: Record<string, string> = {
  review_match: "Match pendente",
  review_ranking: "Ranking ambíguo",
  no_offer: "Sem oferta",
  no_master_candidate: "Sem produto mestre",
  source_changed: "Dados alterados",
  economy_opportunity: "Economia",
  stale_sourcing: "Seleção desatualizada",
  stale_publication: "Publicação desatualizada",
  inactive_item: "Item inativo",
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
}

export function CreateMasterForm({ item }: { item: ItemData }) {
  const [state, action, pending] = useActionState(createMasterFromItem, {});
  const nd = item.normalized_data ?? {};

  return (
    <form action={action} className="space-y-3 rounded-lg border border-brand-line bg-white p-4">
      <h3 className="text-sm font-semibold text-brand-fg">Criar produto mestre</h3>
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
        {pending ? "Criando…" : "Criar master e aprovar"}
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
      <h3 className="text-sm font-semibold text-brand-fg">Associar a master existente</h3>
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
            {pending ? "Vinculando…" : "Vincular"}
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

export function NoMasterActions({ item }: { item: ItemData }) {
  const [mode, setMode] = useState<"idle" | "create" | "associate">("idle");
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectNormalizedItem, {});

  if (mode === "create") return <CreateMasterForm item={item} />;
  if (mode === "associate") return <AssociateMasterForm itemId={item.id} />;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => setMode("create")} className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700">
        Criar master
      </button>
      <button onClick={() => setMode("associate")} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700">
        Associar
      </button>
      <form action={rejectAction}>
        <input type="hidden" name="itemId" value={item.id} />
        <button disabled={rejectPending} className="rounded bg-gray-400 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-500 disabled:opacity-50">
          {rejectPending ? "…" : "Ignorar"}
        </button>
      </form>
      {rejectState?.error && <span className="text-xs text-red-600">{rejectState.error}</span>}
      {rejectState?.ok && <span className="text-xs text-green-600">{rejectState.ok}</span>}
    </div>
  );
}
