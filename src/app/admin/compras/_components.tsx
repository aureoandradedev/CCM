"use client";

import { useActionState } from "react";

import { useState, useTransition } from "react";

import { approveMatch, rejectMatch, selectOffer, publishProduct, processarPendencias, processarCatalogo, resolveException, createMasterFromItem, associateToMaster, ignoreItem, restoreIgnoredItem, searchMasters, backfillApprovedOffers, revokeBinding, undoItemApproval } from "./actions";
import type { BindingInfo } from "./actions";
import type { ScopedItemReport } from "@/lib/admin/catalog-processor";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  supplier_id?: string | null;
  supplier_sku?: string | null;
}

export function CreateMasterForm({ item, onCancel }: { item: ItemData; onCancel?: () => void }) {
  const [state, action, pending] = useActionState(createMasterFromItem, {});
  const nd = item.normalized_data ?? {};

  return (
    <form action={action} className="space-y-3 rounded-lg border border-brand-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-fg">Criar novo produto</h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-brand-fg/50 hover:text-brand-fg hover:underline">
            ← Voltar
          </button>
        )}
      </div>
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

export function AssociateMasterForm({ itemId, itemName, supplierName, supplierSku, itemEan, onCancel, onCreateNew }: {
  itemId: string;
  itemName?: string;
  supplierName?: string;
  supplierSku?: string | null;
  itemEan?: string | null;
  onCancel?: () => void;
  onCreateNew?: () => void;
}) {
  const [state, action, pending] = useActionState(associateToMaster, {});
  const [results, setResults] = useState<{ id: string; name: string; brand_slug: string | null; model: string | null; ean: string | null }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [searching, startSearch] = useTransition();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);

  function handleSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    startSearch(async () => {
      const r = await searchMasters(q);
      setResults(r);
      setSearched(true);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-fg">Escolher produto existente</h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-brand-fg/50 hover:text-brand-fg hover:underline">
            ← Voltar
          </button>
        )}
      </div>
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
      {searched && !searching && results.length === 0 && (
        <div className="space-y-1 rounded bg-gray-50 p-3 text-xs text-brand-fg/70">
          <p>Nenhum produto encontrado.</p>
          {onCreateNew && (
            <button type="button" onClick={onCreateNew} className="font-medium text-green-700 hover:underline">
              Criar este item como novo produto
            </button>
          )}
        </div>
      )}
      {selected && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Vinculando…" : "Confirmar escolha"}
            </button>
            <button type="button" onClick={() => { setSelected(null); setResults([]); setQuery(""); setConfirmOpen(false); }} className="text-xs text-brand-fg/50 hover:underline">
              Cancelar
            </button>
          </div>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Vincular produto"
            description="Tem certeza que deseja vincular este item ao produto mestre selecionado?"
            confirmLabel="Sim, vincular"
            onConfirm={() => {
              const fd = new FormData();
              fd.set("itemId", itemId);
              fd.set("masterProductId", selected);
              action(fd);
              setConfirmOpen(false);
            }}
            pending={pending}
          >
            <div className="space-y-1 rounded bg-gray-50 p-3 text-xs">
              {supplierName && <p><strong>Fornecedor:</strong> {supplierName}</p>}
              {supplierSku && <p><strong>SKU:</strong> {supplierSku}</p>}
              {itemEan && <p><strong>EAN:</strong> {itemEan}</p>}
              {itemName && <p><strong>Produto do fornecedor:</strong> {itemName}</p>}
              <p className="mt-2"><strong>Produto mestre escolhido:</strong> {results.find((r) => r.id === selected)?.name ?? selected}</p>
              {results.find((r) => r.id === selected)?.ean && (
                <p><strong>EAN mestre:</strong> {results.find((r) => r.id === selected)!.ean}</p>
              )}
            </div>
            <p className="text-xs text-amber-700">
              Um vínculo será criado para reutilização futura.
            </p>
          </ConfirmDialog>
        </>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-xs text-green-600">{state.ok}</p>}
    </div>
  );
}

// ─── Restaurar item ignorado ─────────────────────────────────────────────

export function RestoreIgnoredButton({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [state, action, pending] = useActionState(restoreIgnoredItem, {});
  const [confirm, setConfirm] = useState(false);

  function handleConfirm() {
    const fd = new FormData();
    fd.set("itemId", itemId);
    action(fd);
    setConfirm(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={pending}
        className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "…" : "Voltar para revisão"}
      </button>
      {state?.error && <span className="ml-1 text-xs text-red-600">{state.error}</span>}
      {state?.ok && <span className="ml-1 text-xs text-green-600">{state.ok}</span>}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Restaurar item"
        description="Deseja devolver este item para a fila de pendências?"
        confirmLabel="Sim, restaurar"
        onConfirm={handleConfirm}
        pending={pending}
      >
        <div className="rounded bg-gray-50 p-3 text-xs">
          <p><strong>Item:</strong> {itemName}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}

// ─── Desfazer aprovação (corrigir vínculo pós-confirmação) ──────────────

export function UndoApprovalButton({ itemId, itemName, masterProductName }: {
  itemId: string;
  itemName: string;
  masterProductName: string | null;
}) {
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);

  function handleConfirm() {
    startTransition(async () => {
      const r = await undoItemApproval(itemId, reason || undefined);
      setResult(r);
      if (r.ok) setConfirm(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={pending}
        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {pending ? "…" : "Corrigir vínculo"}
      </button>
      {result?.error && <span className="ml-1 text-xs text-red-600">{result.error}</span>}
      {result?.ok && <span className="ml-1 text-xs text-green-600">{result.ok}</span>}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Corrigir vínculo"
        variant="destructive"
        confirmLabel="Revogar e devolver para pendências"
        onConfirm={handleConfirm}
        pending={pending}
      >
        <div className="space-y-3 text-sm">
          <p>Deseja desfazer esta aprovação? Os vínculos ativos serão revogados e o item voltará para as pendências.</p>
          <div className="space-y-1 rounded bg-gray-50 p-3 text-xs">
            <p><strong>Item do fornecedor:</strong> {itemName}</p>
            <p><strong>Produto mestre atual:</strong> {masterProductName ?? "—"}</p>
          </div>
          <input
            type="text"
            placeholder="Motivo da correção (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded border border-brand-line px-2 py-1.5 text-xs"
          />
          <p className="text-xs text-red-700">
            Todos os vínculos (SKU, EAN, nome) entre este fornecedor e o produto mestre serão revogados. O histórico será preservado.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}

// ─── Labels de vínculo ───────────────────────────────────────────────────

const BINDING_TYPE_LABEL: Record<string, string> = {
  supplier_sku: "SKU do fornecedor",
  ean: "Código EAN",
  normalized_name: "Nome normalizado",
};

const BINDING_ORIGIN_LABEL: Record<string, string> = {
  admin_approve: "Aprovação manual",
  admin_create: "Produto criado",
  admin_associate: "Associação manual",
  auto_ean: "EAN automático",
  auto_reuse: "Reutilização automática",
};

// ─── Dialog de vínculos ──────────────────────────────────────────────────

function BindingsDialog({ open, onOpenChange, bindings: initialBindings, itemName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: BindingInfo[];
  itemName: string;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revokePending, startRevoke] = useTransition();
  const [revokeResult, setRevokeResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [revokedIds, setRevokedIds] = useState<Set<string>>(new Set());

  function handleRevoke(bindingId: string) {
    startRevoke(async () => {
      const result = await revokeBinding(bindingId, reason || undefined);
      setRevokeResult(result);
      if (result.ok) {
        setRevokedIds((prev) => new Set(prev).add(bindingId));
        setRevoking(null);
        setReason("");
      }
    });
  }

  const activeBindings = initialBindings.filter((b) => !revokedIds.has(b.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vínculos ativos</DialogTitle>
          <DialogDescription>
            Vínculos de identificação do item &ldquo;{itemName}&rdquo;. Revogar um vínculo impede que ele seja reutilizado automaticamente em futuras importações.
          </DialogDescription>
        </DialogHeader>

        {activeBindings.length === 0 ? (
          <p className="text-sm text-brand-fg/50">Nenhum vínculo ativo encontrado para este item.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {activeBindings.map((b) => (
              <div key={b.id} className="space-y-1 rounded border border-brand-line p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    {BINDING_TYPE_LABEL[b.bindingType] ?? b.bindingType}
                  </span>
                  <span className="text-brand-fg/40">{new Date(b.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
                <p><strong>Produto:</strong> {b.masterProductName ?? b.masterProductId}</p>
                {b.masterProductEan && <p><strong>EAN:</strong> {b.masterProductEan}</p>}
                {b.supplierSku && <p><strong>SKU fornecedor:</strong> {b.supplierSku}</p>}
                {b.eanClean && <p><strong>EAN limpo:</strong> {b.eanClean}</p>}
                {b.normalizedName && <p><strong>Nome:</strong> {b.normalizedName}</p>}
                {b.confidence != null && <p><strong>Confiança:</strong> {b.confidence}%</p>}
                <p className="text-brand-fg/40">Origem: {BINDING_ORIGIN_LABEL[b.origin] ?? b.origin}</p>

                {revoking === b.id ? (
                  <div className="mt-2 space-y-2 rounded bg-red-50 p-2">
                    <p className="text-xs font-medium text-red-800">Tem certeza que deseja revogar este vínculo?</p>
                    <p className="text-[10px] text-red-700">
                      Esta ação não pode ser desfeita. Itens futuros não serão mais vinculados automaticamente por este critério.
                    </p>
                    <input
                      type="text"
                      placeholder="Motivo da revogação (opcional)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleRevoke(b.id)}
                        disabled={revokePending}
                        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {revokePending ? "Revogando…" : "Confirmar revogação"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRevoking(null); setReason(""); }}
                        disabled={revokePending}
                        className="text-xs text-brand-fg/50 hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevoking(b.id)}
                    className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    Revogar vínculo
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {revokeResult?.error && <p className="text-xs text-red-600">{revokeResult.error}</p>}
        {revokeResult?.ok && <p className="text-xs text-green-600">{revokeResult.ok}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ações para item sem master ───────────────────────────────────────────

export function NoMasterActions({ item, reviewMode, masterProductEan, matchConfidence }: {
  item: ItemData;
  reviewMode?: boolean;
  masterProductEan?: string | null;
  matchConfidence?: number | null;
}) {
  const [mode, setMode] = useState<"idle" | "create" | "associate">("idle");
  const [confirmAction, setConfirmAction] = useState<null | "approve" | "ignore">(null);

  const [ignoreState, ignoreAction, ignorePending] = useActionState(ignoreItem, {});
  const [approveState, approveAction, approvePending] = useActionState(approveMatch, {});
  const pending = ignorePending || approvePending;

  function handleApproveConfirm() {
    const fd = new FormData();
    fd.set("itemId", item.id);
    fd.set("masterProductId", item.master_product_id!);
    approveAction(fd);
    setConfirmAction(null);
  }

  function handleIgnoreConfirm() {
    const fd = new FormData();
    fd.set("itemId", item.id);
    ignoreAction(fd);
    setConfirmAction(null);
  }

  if (mode === "create") return <CreateMasterForm item={item} onCancel={() => setMode("idle")} />;
  if (mode === "associate") return <AssociateMasterForm itemId={item.id} itemName={item.name} supplierSku={item.supplier_sku} itemEan={item.ean} onCancel={() => setMode("idle")} onCreateNew={() => setMode("create")} />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.master_product_id && (
          <button
            type="button"
            onClick={() => setConfirmAction("approve")}
            disabled={pending}
            className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {approvePending ? "…" : "Confirmar produto"}
          </button>
        )}
        <button type="button" onClick={() => setMode("associate")} disabled={pending} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          Escolher outro produto
        </button>
        <button type="button" onClick={() => setMode("create")} disabled={pending} className="rounded border border-green-600 bg-white px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">
          Criar novo produto
        </button>
        <button
          type="button"
          onClick={() => setConfirmAction("ignore")}
          disabled={pending}
          className="rounded bg-gray-400 px-2 py-0.5 text-xs font-medium text-white hover:bg-gray-500 disabled:opacity-50"
        >
          {ignorePending ? "…" : "Ignorar por enquanto"}
        </button>
        {approveState?.error && <span className="text-xs text-red-600">{approveState.error}</span>}
        {approveState?.ok && <span className="text-xs text-green-600">{approveState.ok}</span>}
        {ignoreState?.error && <span className="text-xs text-red-600">{ignoreState.error}</span>}
        {ignoreState?.ok && <span className="text-xs text-green-600">{ignoreState.ok}</span>}
      </div>

      <ConfirmDialog
        open={confirmAction === "approve"}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title="Confirmar produto"
        confirmLabel="Sim, confirmar"
        onConfirm={handleApproveConfirm}
        pending={approvePending}
      >
        <div className="space-y-2 text-sm">
          <p>Deseja confirmar que este item do fornecedor corresponde ao produto mestre?</p>
          <div className="space-y-1 rounded bg-gray-50 p-3 text-xs">
            <p><strong>Item:</strong> {item.name}</p>
            <p><strong>Produto mestre:</strong> {item.master_product_name ?? "—"}</p>
            {masterProductEan && <p><strong>EAN:</strong> {masterProductEan}</p>}
            {matchConfidence != null && <p><strong>Confiança:</strong> {matchConfidence}%</p>}
          </div>
          <p className="text-xs text-amber-700">
            Um vínculo será criado para reutilização futura. Itens do mesmo fornecedor com mesmo SKU/EAN/nome serão vinculados automaticamente.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAction === "ignore"}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title="Ignorar item por enquanto"
        description="Deseja ignorar este item temporariamente?"
        confirmLabel="Sim, ignorar"
        onConfirm={handleIgnoreConfirm}
        pending={ignorePending}
      >
        <div className="space-y-2 text-sm">
          <div className="rounded bg-gray-50 p-3 text-xs">
            <p><strong>Item:</strong> {item.name}</p>
          </div>
          <p className="text-xs text-brand-fg/60">
            O item será movido para a aba &ldquo;Ignorados&rdquo; e não aparecerá nas pendências ativas. Você pode restaurá-lo a qualquer momento clicando &ldquo;Voltar para revisão&rdquo;.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
