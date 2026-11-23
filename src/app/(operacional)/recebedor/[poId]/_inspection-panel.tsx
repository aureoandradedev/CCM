"use client";

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { uploadReceivingPhoto, getSignedPhotoUrl } from "../actions";
import { OpProgress, OpKpi } from "@/components/operational/operational-ui";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ExpectedItem {
  id: string;
  masterProductId: string;
  name: string;
  expectedQty: number;
}

interface InspectedItem {
  purchaseOrderItemId: string;
  masterProductId: string;
  receivedQty: number;
  acceptedQty: number;
  damagedQty: number;
  notes: string;
  photos: string[];
  saved: boolean;
}

type Phase = "idle" | "inspecting" | "confirm" | "summary" | "done" | "error";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InspectionPanel({
  poId,
  expectedItems,
  existingSessionId,
}: {
  poId: string;
  expectedItems: ExpectedItem[];
  existingSessionId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>(existingSessionId ? "inspecting" : "idle");
  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [items, setItems] = useState<Map<string, InspectedItem>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());

  const getItem = useCallback(
    (poiId: string): InspectedItem => {
      return (
        items.get(poiId) ?? {
          purchaseOrderItemId: poiId,
          masterProductId: expectedItems.find((e) => e.id === poiId)?.masterProductId ?? "",
          receivedQty: 0,
          acceptedQty: 0,
          damagedQty: 0,
          notes: "",
          photos: [],
          saved: false,
        }
      );
    },
    [items, expectedItems],
  );

  function updateField(poiId: string, field: keyof InspectedItem, value: string | number) {
    setItems((prev) => {
      const next = new Map(prev);
      const item = getItem(poiId);
      next.set(poiId, { ...item, [field]: value, saved: false });
      return next;
    });
  }

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<{ session: { id: string }; expectedItems: ExpectedItem[] }>("/recebimento/start", {
        body: { purchaseOrderId: poId },
      });
      setSessionId(json.session.id);
      setPhase("inspecting");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveItem(poiId: string) {
    const item = getItem(poiId);
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/recebimento/item", {
        body: {
          sessionId,
          purchaseOrderItemId: item.purchaseOrderItemId,
          masterProductId: item.masterProductId,
          expectedQty: expectedItems.find((e) => e.id === poiId)?.expectedQty ?? 0,
          receivedQty: item.receivedQty,
          acceptedQty: item.acceptedQty,
          damagedQty: item.damagedQty,
          notes: item.notes,
          photos: item.photos,
        },
      });
      setItems((prev) => {
        const next = new Map(prev);
        next.set(poiId, { ...item, saved: true });
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoUpload(poiId: string, file: File) {
    if (!sessionId) return;
    const item = getItem(poiId);
    if (item.photos.length >= 10) {
      setError("Máximo de 10 fotos por item.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const { path } = await uploadReceivingPhoto(sessionId, poiId, fd);
      setItems((prev) => {
        const next = new Map(prev);
        const updated = getItem(poiId);
        next.set(poiId, { ...updated, photos: [...updated.photos, path], saved: false });
        return next;
      });
      const url = await getSignedPhotoUrl(path);
      setPhotoUrls((prev) => new Map(prev).set(path, url));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleShowConfirm() {
    setPhase("confirm");
  }

  async function handleComplete() {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<{ summary: Record<string, number> }>("/recebimento/complete", {
        body: { sessionId },
      });
      setSummary(json.summary);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("confirm");
    } finally {
      setBusy(false);
    }
  }

  const savedCount = Array.from(items.values()).filter((i) => i.saved).length;
  const allSaved = savedCount === expectedItems.length;

  /* ================================================================ */
  /*  Render: Idle                                                     */
  /* ================================================================ */
  if (phase === "idle") {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl bg-white py-12 text-center shadow-sm ring-1 ring-black/[0.04]">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-brand-navy/10">
          <Package className="size-8 text-brand-navy" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Pronto para iniciar a conferência?</p>
          <p className="mt-1 text-xs text-gray-500">{expectedItems.length} itens esperados neste pedido.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className="min-h-12 min-w-52 rounded-xl bg-brand-navy px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="mx-auto size-5 animate-spin" /> : "Iniciar conferência"}
        </button>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Error                                                    */
  /* ================================================================ */
  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl bg-red-50 py-12 text-center ring-1 ring-red-200">
        <AlertTriangle className="size-10 text-red-500" />
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-gray-700 ring-1 ring-black/[0.08]"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Inspecting                                               */
  /* ================================================================ */
  if (phase === "inspecting") {
    const current = expectedItems[currentIdx];
    if (!current) return null;
    const item = getItem(current.id);

    return (
      <div className="space-y-4">
        {/* Progress */}
        <OpProgress current={savedCount} total={expectedItems.length} />

        {/* Item navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => i - 1)}
            className="inline-flex size-10 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="text-sm font-bold text-brand-navy">
            Item {currentIdx + 1} de {expectedItems.length}
          </span>
          <button
            type="button"
            disabled={currentIdx === expectedItems.length - 1}
            onClick={() => setCurrentIdx((i) => i + 1)}
            className="inline-flex size-10 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {/* Item card */}
        <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-heading text-sm font-bold text-gray-900">{current.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">Esperado: {current.expectedQty} un.</p>
            </div>
            {item.saved && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[0.65rem] font-semibold text-emerald-700">
                <Check className="size-3" /> Salvo
              </span>
            )}
          </div>

          {/* Quantity inputs */}
          <div className="grid grid-cols-3 gap-3">
            <QuantityInput label="Recebido" value={item.receivedQty} onChange={(v) => updateField(current.id, "receivedQty", v)} />
            <QuantityInput label="Aceito" value={item.acceptedQty} onChange={(v) => updateField(current.id, "acceptedQty", v)} max={item.receivedQty} />
            <QuantityInput label="Avariado" value={item.damagedQty} onChange={(v) => updateField(current.id, "damagedQty", v)} max={item.receivedQty - item.acceptedQty} warn />
          </div>

          {/* Validation feedback */}
          {item.receivedQty > 0 && item.acceptedQty + item.damagedQty > item.receivedQty && (
            <p className="text-xs font-medium text-red-600">Aceito + Avariado não pode ser maior que Recebido.</p>
          )}

          {/* Divergence indicators */}
          {item.receivedQty > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.receivedQty < current.expectedQty && (
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[0.65rem] font-semibold text-red-700">
                  Falta: {current.expectedQty - item.receivedQty}
                </span>
              )}
              {item.receivedQty > current.expectedQty && (
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[0.65rem] font-semibold text-blue-700">
                  Excesso: {item.receivedQty - current.expectedQty}
                </span>
              )}
              {item.damagedQty > 0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[0.65rem] font-semibold text-amber-700">
                  Avaria: {item.damagedQty}
                </span>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-500">Observações</label>
            <textarea
              rows={2}
              className="mt-1.5 w-full rounded-xl bg-gray-50 px-3 py-2.5 text-sm outline-none ring-1 ring-black/[0.06] transition-shadow placeholder:text-gray-400 focus:ring-2 focus:ring-brand-navy/30"
              value={item.notes}
              onChange={(e) => updateField(current.id, "notes", e.target.value)}
              placeholder="Ex: embalagem violada, produto trocado..."
            />
          </div>

          {/* Photos */}
          <div>
            <p className="text-xs font-medium text-gray-500">Fotos ({item.photos.length}/10)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.photos.map((path) => (
                <div key={path} className="relative size-16 overflow-hidden rounded-xl bg-gray-100 ring-1 ring-black/[0.06]">
                  {photoUrls.get(path) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrls.get(path)} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Camera className="size-5 text-gray-300" />
                    </div>
                  )}
                </div>
              ))}
              {item.photos.length < 10 && (
                <label className="flex size-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-gray-400 transition-colors hover:border-brand-navy hover:text-brand-navy">
                  <Camera className="size-5" />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(current.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Save button */}
          <button
            type="button"
            className="min-h-12 w-full rounded-xl bg-brand-navy text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
            disabled={busy || item.receivedQty === 0 || item.acceptedQty + item.damagedQty > item.receivedQty}
            onClick={() => handleSaveItem(current.id)}
          >
            {busy ? <Loader2 className="mx-auto size-5 animate-spin" /> : item.saved ? "Atualizar item" : "Salvar item"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Quick jump */}
        <div className="flex flex-wrap gap-1.5">
          {expectedItems.map((ei, idx) => {
            const it = items.get(ei.id);
            return (
              <button
                key={ei.id}
                type="button"
                onClick={() => setCurrentIdx(idx)}
                className={cn(
                  "size-9 rounded-xl text-xs font-bold transition-colors",
                  idx === currentIdx
                    ? "bg-brand-navy text-white shadow-sm"
                    : it?.saved
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-400",
                )}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        {/* Finalize */}
        {allSaved && (
          <button
            type="button"
            onClick={handleShowConfirm}
            className="min-h-12 w-full rounded-xl bg-white text-base font-bold text-brand-navy ring-2 ring-brand-navy transition-colors hover:bg-brand-navy/5"
          >
            Finalizar conferência
          </button>
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Confirm                                                  */
  /* ================================================================ */
  if (phase === "confirm") {
    const allItems = expectedItems.map((ei) => ({ expected: ei, inspected: getItem(ei.id) }));
    const totalExpected = allItems.reduce((s, i) => s + i.expected.expectedQty, 0);
    const totalReceived = allItems.reduce((s, i) => s + i.inspected.receivedQty, 0);
    const totalAccepted = allItems.reduce((s, i) => s + i.inspected.acceptedQty, 0);
    const totalDamaged = allItems.reduce((s, i) => s + i.inspected.damagedQty, 0);
    const shortages = allItems.filter((i) => i.inspected.receivedQty < i.expected.expectedQty);
    const excess = allItems.filter((i) => i.inspected.receivedQty > i.expected.expectedQty);

    return (
      <div className="space-y-5">
        <h2 className="font-heading text-base font-bold text-brand-navy">Confirmar finalização</h2>
        <p className="text-xs text-gray-500">
          Revise os dados abaixo. Após finalizar, o sistema calculará divergências e exceções automaticamente.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <OpKpi label="Esperado" value={totalExpected} />
          <OpKpi label="Recebido" value={totalReceived} tone={totalReceived !== totalExpected ? "warn" : "default"} />
          <OpKpi label="Aceito" value={totalAccepted} />
          <OpKpi label="Avariado" value={totalDamaged} tone={totalDamaged > 0 ? "danger" : "default"} />
        </div>

        {(shortages.length > 0 || excess.length > 0) && (
          <div className="space-y-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200/50">
            <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
              <AlertTriangle className="size-3.5" /> Divergências detectadas
            </p>
            {shortages.map((s) => (
              <p key={s.expected.id} className="text-xs text-gray-600">
                <span className="font-semibold text-red-700">Falta:</span> {s.expected.name} — esperado {s.expected.expectedQty}, recebido {s.inspected.receivedQty}
              </p>
            ))}
            {excess.map((s) => (
              <p key={s.expected.id} className="text-xs text-gray-600">
                <span className="font-semibold text-blue-700">Excesso:</span> {s.expected.name} — esperado {s.expected.expectedQty}, recebido {s.inspected.receivedQty}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase("inspecting")}
            className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-gray-500 ring-1 ring-black/[0.08] transition-colors hover:bg-gray-50"
          >
            <ChevronLeft className="size-4" /> Voltar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleComplete}
            className="min-h-12 flex-1 rounded-xl bg-brand-navy text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto size-5 animate-spin" /> : "Confirmar e finalizar"}
          </button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Done                                                     */
  /* ================================================================ */
  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl bg-emerald-50 py-12 text-center ring-1 ring-emerald-200/50">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle className="size-8 text-emerald-600" />
        </div>
        <div>
          <p className="font-heading text-base font-bold text-gray-900">Conferência finalizada</p>
          <p className="mt-1 text-xs text-gray-500">
            O admin revisará a alocação de estoque. Exceções foram registradas automaticamente.
          </p>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 px-6">
            <OpKpi label="Esperado" value={summary.totalExpected} />
            <OpKpi label="Recebido" value={summary.totalReceived} />
            <OpKpi label="Aceito" value={summary.totalAccepted} />
            <OpKpi label="Avariado" value={summary.totalDamaged} tone={summary.totalDamaged > 0 ? "danger" : "default"} />
          </div>
        )}

        <a
          href="/recebedor"
          className="mt-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-navy shadow-sm ring-1 ring-black/[0.04] transition-colors hover:bg-gray-50"
        >
          Voltar ao painel
        </a>
      </div>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function QuantityInput({
  label,
  value,
  onChange,
  max,
  warn,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  warn?: boolean;
}) {
  return (
    <label className="space-y-1.5">
      <span className={cn("text-[0.65rem] font-semibold", warn ? "text-amber-600" : "text-gray-500")}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        className={cn(
          "h-12 w-full rounded-xl bg-gray-50 text-center text-lg font-bold outline-none ring-1 transition-shadow",
          "focus:ring-2 focus:ring-brand-navy/30",
          warn && value > 0 ? "text-amber-600 ring-amber-300" : "text-gray-800 ring-black/[0.06]",
        )}
        value={value || ""}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      />
    </label>
  );
}
