"use client";

import { useActionState } from "react";

import { adjustInventory, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls, selectCls } from "@/components/admin/ui";

export function InventoryMovementForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(adjustInventory, {});

  return (
    <form action={action} className="rounded-2xl border border-brand-line bg-card p-5">
      <h3 className="mb-4 font-heading text-base font-bold text-brand-navy">
        Registrar movimento manual
      </h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="ID produto mestre">
          <input type="text" name="master_product_id" required className={inputCls} placeholder="uuid" />
        </Field>

        <Field label="Tipo">
          <select name="movement_type" required className={selectCls}>
            <option value="">Selecione</option>
            <option value="purchase_leftover">Sobra de compra</option>
            <option value="sale_from_stock">Venda do estoque</option>
            <option value="adjustment">Ajuste</option>
            <option value="write_off">Baixa</option>
          </select>
        </Field>

        <Field label="Quantidade" hint="Positivo sempre">
          <input type="number" name="quantity" required min="1" className={inputCls} />
        </Field>

        <Field label="Custo un. (centavos)" hint="Para sobra de compra">
          <input type="number" name="unit_cost_centavos" className={inputCls} />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Motivo" hint="Opcional — para ajustes e baixas">
          <input type="text" name="reason" className={inputCls} placeholder="Ajuste de contagem" />
        </Field>
        <Field label="Fornecedor ID" hint="Opcional — para sobra de compra">
          <input type="text" name="supplier_id" className={inputCls} />
        </Field>
      </div>

      <Feedback state={state} />

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-navy px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-navy/90 disabled:opacity-50"
        >
          {pending ? "Registrando..." : "Registrar movimento"}
        </button>
      </div>
    </form>
  );
}
