"use client";

import { useActionState, useState } from "react";
import { Percent, Plus, Save, Trash2 } from "lucide-react";

import { deleteSupplierPromotion, saveSupplierPromotion, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { SupplierPromotionRow } from "@/lib/admin/types";

export function SupplierPromoPanel({
  supplierId,
  promo,
}: {
  supplierId: string;
  promo: SupplierPromotionRow | null;
}) {
  const [result, action, pending] = useActionState<ActionResult, FormData>(saveSupplierPromotion, {});
  const [editing, setEditing] = useState(!!promo);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!promo) return;
    setDeleting(true);
    await deleteSupplierPromotion(promo.id);
    setDeleting(false);
    setEditing(false);
  };

  if (!editing && !promo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Percent className="size-4 text-brand-navy" />
          <span className="text-sm font-semibold text-brand-ink">Promoção automática</span>
        </div>
        <p className="text-xs text-brand-ink-soft">
          Nenhuma promoção configurada. O desconto é aplicado automaticamente sobre todos os produtos deste fornecedor, respeitando a margem mínima.
        </p>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
          <Plus className="size-3.5" />
          Criar promoção
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Percent className="size-4 text-brand-navy" />
        <span className="text-sm font-semibold text-brand-ink">Promoção automática</span>
        {promo?.active ? (
          <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[0.65rem] font-bold text-brand-green">ATIVA</span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-bold text-brand-ink-soft">INATIVA</span>
        )}
      </div>

      <Feedback state={result} />

      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="supplier_id" value={supplierId} />
        {promo ? <input type="hidden" name="promo_id" value={promo.id} /> : null}

        <Field label="Desconto (%)" hint="1 a 50%">
          <input
            name="discount_pct"
            type="number"
            step="0.01"
            min="0.01"
            max="50"
            className={inputCls}
            defaultValue={promo?.discount_pct ?? 5}
          />
        </Field>

        <Field label="Margem mínima (%)" hint="Piso de margem sobre o custo">
          <input
            name="min_margin_pct"
            type="number"
            step="0.01"
            min="0"
            className={inputCls}
            defaultValue={promo?.min_margin_pct ?? 10}
          />
        </Field>

        <Field label="Início (opcional)">
          <input name="valid_from" type="date" className={inputCls} defaultValue={promo?.valid_from ?? ""} />
        </Field>

        <Field label="Fim (opcional)">
          <input name="valid_to" type="date" className={inputCls} defaultValue={promo?.valid_to ?? ""} />
        </Field>

        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="hidden" name="active" value="false" />
          <input type="checkbox" name="active" value="true" className="size-4 accent-[var(--ccm-navy)]" defaultChecked={promo?.active ?? false} />
          <span className="text-sm font-medium text-brand-ink">Ativa</span>
        </label>

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="navy" size="sm" disabled={pending} className="gap-1.5">
            <Save className="size-3.5" />
            {pending ? "Salvando..." : "Salvar promoção"}
          </Button>
          {promo ? (
            <Button type="button" variant="ghost" size="sm" className="text-brand-red" disabled={deleting} onClick={handleDelete}>
              <Trash2 className="size-3.5" />
              {deleting ? "Removendo..." : "Remover"}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
