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
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { uploadReceivingPhoto, getSignedPhotoUrl } from "../actions";

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

  /* ---- Start session ---- */
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

  /* ---- Save one item ---- */
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

  /* ---- Photo upload ---- */
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

  /* ---- Pre-finalize confirmation ---- */
  function handleShowConfirm() {
    setPhase("confirm");
  }

  /* ---- Complete session ---- */
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
      <div className="flex flex-col items-center gap-4 rounded-xl border border-brand-line bg-card py-10 text-center">
        <Package className="size-12 text-brand-navy" />
        <div>
          <p className="text-sm font-medium text-brand-ink">Pronto para iniciar a conferência?</p>
          <p className="mt-1 text-xs text-brand-ink-soft">{expectedItems.length} itens esperados neste pedido.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button size="lg" onClick={handleStart} disabled={busy} className="min-h-12 min-w-48 text-base">
          {busy ? <Loader2 className="size-5 animate-spin" /> : "Iniciar conferência"}
        </Button>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Error                                                    */
  /* ================================================================ */
  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-red-200 bg-red-50 py-10 text-center">
        <AlertTriangle className="size-10 text-red-500" />
        <p className="text-sm text-red-700">{error}</p>
        <Button onClick={() => setPhase("idle")}>Tentar novamente</Button>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Inspecting (item by item)                                */
  /* ================================================================ */
  if (phase === "inspecting") {
    const current = expectedItems[currentIdx];
    if (!current) return null;
    const item = getItem(current.id);

    return (
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-brand-navy transition-all"
              style={{ width: `${(savedCount / expectedItems.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-brand-ink-soft">
            {savedCount}/{expectedItems.length}
          </span>
        </div>

        {/* Item navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => i - 1)}
            className="inline-flex size-10 items-center justify-center rounded-lg text-brand-ink-soft disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="text-sm font-semibold text-brand-navy">
            Item {currentIdx + 1} de {expectedItems.length}
          </span>
          <button
            type="button"
            disabled={currentIdx === expectedItems.length - 1}
            onClick={() => setCurrentIdx((i) => i + 1)}
            className="inline-flex size-10 items-center justify-center rounded-lg text-brand-ink-soft disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {/* Item card */}
        <div className="rounded-xl border border-brand-line bg-card p-4 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-heading text-sm font-bold text-brand-ink">{current.name}</p>
              <p className="mt-0.5 text-xs text-brand-ink-soft">Esperado: {current.expectedQty} un.</p>
            </div>
            {item.saved && (
              <span className="flex items-center gap-1 rounded-full bg-brand-green/10 px-2 py-0.5 text-[0.65rem] font-semibold text-brand-green">
                <Check className="size-3" /> Salvo
              </span>
            )}
          </div>

          {/* Quantity inputs — large touch targets */}
          <div className="grid grid-cols-3 gap-3">
            <QuantityInput
              label="Recebido"
              value={item.receivedQty}
              onChange={(v) => updateField(current.id, "receivedQty", v)}
            />
            <QuantityInput
              label="Aceito"
              value={item.acceptedQty}
              onChange={(v) => updateField(current.id, "acceptedQty", v)}
              max={item.receivedQty}
            />
            <QuantityInput
              label="Avariado"
              value={item.damagedQty}
              onChange={(v) => updateField(current.id, "damagedQty", v)}
              max={item.receivedQty - item.acceptedQty}
              warn
            />
          </div>

          {/* Validation feedback */}
          {item.receivedQty > 0 && item.acceptedQty + item.damagedQty > item.receivedQty && (
            <p className="text-xs font-medium text-red-600">Aceito + Avariado não pode ser maior que Recebido.</p>
          )}

          {/* Divergence indicators */}
          {item.receivedQty > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.receivedQty < current.expectedQty && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] font-medium text-red-700">
                  Falta: {current.expectedQty - item.receivedQty}
                </span>
              )}
              {item.receivedQty > current.expectedQty && (
                <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[0.65rem] font-medium text-brand-blue">
                  Excesso: {item.receivedQty - current.expectedQty}
                </span>
              )}
              {item.damagedQty > 0 && (
                <span className="rounded-full bg-brand-orange/10 px-2 py-0.5 text-[0.65rem] font-medium text-brand-orange">
                  Avaria: {item.damagedQty}
                </span>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-brand-ink-soft">Observações</label>
            <textarea
              rows={2}
              className="mt-1 w-full rounded-lg border border-brand-line bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-navy"
              value={item.notes}
              onChange={(e) => updateField(current.id, "notes", e.target.value)}
              placeholder="Ex: embalagem violada, produto trocado..."
            />
          </div>

          {/* Photos */}
          <div>
            <p className="text-xs font-medium text-brand-ink-soft">Fotos ({item.photos.length}/10)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.photos.map((path) => (
                <div key={path} className="relative size-16 overflow-hidden rounded-lg border border-brand-line bg-muted">
                  {photoUrls.get(path) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrls.get(path)} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <Camera className="size-5 text-brand-ink-soft/40" />
                    </div>
                  )}
                </div>
              ))}
              {item.photos.length < 10 && (
                <label className="flex size-16 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-brand-line text-brand-ink-soft hover:border-brand-navy hover:text-brand-navy">
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
          <Button
            className="min-h-12 w-full text-base"
            disabled={busy || item.receivedQty === 0 || item.acceptedQty + item.damagedQty > item.receivedQty}
            onClick={() => handleSaveItem(current.id)}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : item.saved ? "Atualizar item" : "Salvar item"}
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Quick jump list */}
        <div className="flex flex-wrap gap-1">
          {expectedItems.map((ei, idx) => {
            const it = items.get(ei.id);
            return (
              <button
                key={ei.id}
                type="button"
                onClick={() => setCurrentIdx(idx)}
                className={cn(
                  "size-8 rounded-lg text-xs font-semibold transition-colors",
                  idx === currentIdx
                    ? "bg-brand-navy text-white"
                    : it?.saved
                      ? "bg-brand-green/10 text-brand-green"
                      : "bg-muted text-brand-ink-soft",
                )}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        {/* Finalize */}
        {allSaved && (
          <Button
            variant="outline"
            className="min-h-12 w-full border-brand-navy text-base font-bold text-brand-navy"
            onClick={handleShowConfirm}
          >
            Finalizar conferência
          </Button>
        )}
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Confirm before finalize                                  */
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
      <div className="space-y-4">
        <h2 className="font-heading text-base font-bold text-brand-navy">Confirmar finalização</h2>
        <p className="text-xs text-brand-ink-soft">
          Revise os dados abaixo antes de finalizar. Após finalizar, o sistema calculará divergências e exceções automaticamente.
        </p>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <SummaryKpi label="Esperado" value={totalExpected} />
          <SummaryKpi label="Recebido" value={totalReceived} tone={totalReceived !== totalExpected ? "warn" : undefined} />
          <SummaryKpi label="Aceito" value={totalAccepted} />
          <SummaryKpi label="Avariado" value={totalDamaged} tone={totalDamaged > 0 ? "danger" : undefined} />
        </div>

        {/* Divergences */}
        {(shortages.length > 0 || excess.length > 0) && (
          <div className="rounded-xl border border-brand-orange/30 bg-brand-orange/5 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-orange">
              <AlertTriangle className="size-3.5" /> Divergências detectadas
            </p>
            {shortages.map((s) => (
              <p key={s.expected.id} className="text-xs text-brand-ink-soft">
                <span className="font-medium text-red-700">Falta:</span> {s.expected.name} — esperado {s.expected.expectedQty}, recebido {s.inspected.receivedQty}
              </p>
            ))}
            {excess.map((s) => (
              <p key={s.expected.id} className="text-xs text-brand-ink-soft">
                <span className="font-medium text-brand-blue">Excesso:</span> {s.expected.name} — esperado {s.expected.expectedQty}, recebido {s.inspected.receivedQty}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button variant="outline" className="min-h-12 flex-1" onClick={() => setPhase("inspecting")}>
            <ChevronLeft className="size-4" /> Voltar
          </Button>
          <Button className="min-h-12 flex-1 text-base" disabled={busy} onClick={handleComplete}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : "Confirmar e finalizar"}
          </Button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render: Done                                                     */
  /* ================================================================ */
  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-brand-green/30 bg-brand-green/5 py-10 text-center">
        <CheckCircle className="size-12 text-brand-green" />
        <div>
          <p className="font-heading text-base font-bold text-brand-ink">Conferência finalizada</p>
          <p className="mt-1 text-xs text-brand-ink-soft">
            O admin revisará a alocação de estoque. Exceções foram registradas automaticamente.
          </p>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 px-4">
            <SummaryKpi label="Esperado" value={summary.totalExpected} />
            <SummaryKpi label="Recebido" value={summary.totalReceived} />
            <SummaryKpi label="Aceito" value={summary.totalAccepted} />
            <SummaryKpi label="Avariado" value={summary.totalDamaged} tone={summary.totalDamaged > 0 ? "danger" : undefined} />
          </div>
        )}

        <a href="/recebedor" className="mt-2 text-sm font-semibold text-brand-navy underline">
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
    <label className="space-y-1">
      <span className={cn("text-[0.65rem] font-medium", warn ? "text-brand-orange" : "text-brand-ink-soft")}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        className={cn(
          "h-12 w-full rounded-lg border bg-transparent text-center text-lg font-bold outline-none transition-colors",
          "focus:border-brand-navy",
          warn && value > 0 ? "border-brand-orange text-brand-orange" : "border-brand-line text-brand-ink",
        )}
        value={value || ""}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      />
    </label>
  );
}

function SummaryKpi({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <div className="rounded-lg border border-brand-line bg-card p-3 text-center">
      <p
        className={cn(
          "text-2xl font-bold",
          tone === "danger" ? "text-red-600" : tone === "warn" ? "text-brand-orange" : "text-brand-navy",
        )}
      >
        {value}
      </p>
      <p className="text-[0.65rem] text-brand-ink-soft">{label}</p>
    </div>
  );
}
