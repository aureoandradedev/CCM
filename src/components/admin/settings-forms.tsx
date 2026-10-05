"use client";

import { useActionState } from "react";

import { saveDescontos, saveFreight, saveSupplier, saveCategory, setAdminRole, type ActionResult } from "@/app/admin/actions";
import { Feedback, Field, inputCls, selectCls, textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { AdminCategory, AdminSupplier, DescontosSettings, FreteSettings } from "@/lib/admin/types";

export function FreightForm({ value }: { value: FreteSettings }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveFreight, {});
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Frete grátis a partir de (R$)">
          <input name="free_from" defaultValue={(value.freeShippingFromCentavos / 100).toFixed(2).replace(".", ",")} className={inputCls} inputMode="decimal" />
        </Field>
        <Field label="Frete fixo abaixo disso (R$)">
          <input name="flat" defaultValue={(value.flatCentavos / 100).toFixed(2).replace(".", ",")} className={inputCls} inputMode="decimal" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="pickup" defaultChecked={value.pickupEnabled} className="size-4 accent-brand-navy" /> Permitir retirada no fornecedor
      </label>
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar frete"}
      </Button>
    </form>
  );
}

export function DiscountsForm({ value, categories }: { value: DescontosSettings; categories: AdminCategory[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveDescontos, {});
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Desconto no Pix (%)" hint="Aplicado sobre os produtos no checkout.">
          <input name="pixPct" defaultValue={value.pixPct} className={inputCls} inputMode="decimal" />
        </Field>
        <Field label="Primeira compra (%)" hint="Para CPF/CNPJ sem pedido pago anterior.">
          <input name="primeira_pct" defaultValue={value.primeiraCompra.percentual} className={inputCls} inputMode="decimal" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="primeira_ativo" defaultChecked={value.primeiraCompra.ativo} className="size-4 accent-brand-navy" /> Primeira compra ativa
        </label>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-brand-ink">Desconto por seção (%) — vazio = sem desconto</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <label key={c.slug} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{c.name}</span>
              <input name={`secao:${c.slug}`} defaultValue={value.secoes?.[c.slug] ?? ""} className={`${inputCls} h-9 w-20 text-right`} inputMode="decimal" />
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar descontos"}
      </Button>
    </form>
  );
}

export function SupplierForm({ supplier, onDone }: { supplier: AdminSupplier | null; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveSupplier, {});
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={supplier?.id ?? ""} />
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <Field label="Nome">
        <input name="name" defaultValue={supplier?.name ?? ""} className={inputCls} required />
      </Field>
      <Field label="CNPJ">
        <input name="cnpj" defaultValue={supplier?.cnpj ?? ""} className={inputCls} inputMode="numeric" />
      </Field>
      <Field label="Cidade">
        <input name="city" defaultValue={supplier?.city ?? ""} className={inputCls} />
      </Field>
      <Field label="Prazo de despacho (dias úteis)">
        <input name="lead_time_days" defaultValue={supplier?.lead_time_days ?? 3} className={inputCls} inputMode="numeric" />
      </Field>
      <Field label="Contato">
        <input name="contact_name" defaultValue={supplier?.contact_name ?? ""} className={inputCls} />
      </Field>
      <Field label="E-mail do contato">
        <input name="contact_email" defaultValue={supplier?.contact_email ?? ""} className={inputCls} type="email" />
      </Field>
      <Field label="Telefone do contato">
        <input name="contact_phone" defaultValue={supplier?.contact_phone ?? ""} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={supplier?.active ?? true} className="size-4 accent-brand-navy" /> Ativo
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Salvando..." : "Salvar fornecedor"}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Fechar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const TONES = ["yellow", "orange", "navy", "green", "blue", "red", "slate"];

export function CategoryForm({ category, onDone }: { category: AdminCategory | null; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCategory, {});
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-card p-4 sm:grid-cols-2">
      <input type="hidden" name="slug" value={category?.slug ?? ""} />
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <Field label="Nome">
        <input name="name" defaultValue={category?.name ?? ""} className={inputCls} required />
      </Field>
      <Field label="Ícone (nome lucide)" hint="Ex.: Hammer, PaintRoller, Droplets, Zap">
        <input name="icon" defaultValue={category?.icon ?? "Package"} className={inputCls} />
      </Field>
      <Field label="Descrição" className="sm:col-span-2">
        <input name="description" defaultValue={category?.description ?? ""} className={inputCls} />
      </Field>
      <Field label="Imagem (URL)">
        <input name="image" defaultValue={category?.image ?? ""} className={inputCls} />
      </Field>
      <Field label="Cor">
        <select name="tone" defaultValue={category?.tone ?? ""} className={selectCls}>
          <option value="">—</option>
          {TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ordem">
        <input name="sort" defaultValue={category?.sort ?? 0} className={inputCls} inputMode="numeric" />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={category?.active ?? true} className="size-4 accent-brand-navy" /> Ativa
      </label>
      <Field label="Subcategorias (uma por linha)" hint='"Nome" ou "slug|Nome". Linhas removidas apagam a subcategoria.' className="sm:col-span-2">
        <textarea name="subcategories" defaultValue={(category?.subcategories ?? []).map((s) => `${s.slug}|${s.name}`).join("\n")} className={textareaCls} rows={5} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Salvando..." : "Salvar categoria"}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Fechar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function AdminRoleForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setAdminRole, {});
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <Field label="E-mail da conta" hint="A pessoa precisa ter se cadastrado na loja antes.">
        <input name="email" type="email" className={inputCls} required />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" name="acao" value="tornar" variant="navy" size="sm" disabled={pending}>
          Tornar admin
        </Button>
        <Button type="submit" name="acao" value="revogar" variant="outline" size="sm" disabled={pending}>
          Revogar
        </Button>
      </div>
    </form>
  );
}
