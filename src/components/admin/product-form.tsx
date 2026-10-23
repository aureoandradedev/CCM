"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { saveProduct, type ActionResult } from "@/app/admin/actions";
import { ProductImages } from "@/components/admin/product-images";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { Card, Feedback, Field, inputCls, selectCls, textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { AdminCategory, AdminProduct, AdminSupplier } from "@/lib/admin/types";

const UNITS = ["un", "m²", "m", "saco", "lata", "cx", "kg", "l", "par", "pç", "rolo", "galão", "balde", "barra", "milheiro"];
const BADGES = ["oferta", "novo", "mais-vendido", "frete-gratis", "atacado", "lancamento"];

export function ProductForm({ product, id, categories, suppliers, brands }: { product: AdminProduct | null; id: string; categories: AdminCategory[]; suppliers: AdminSupplier[]; brands: string[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveProduct, {});
  const [category, setCategory] = useState(product?.category_slug ?? categories[0]?.slug ?? "");
  const subs = categories.find((c) => c.slug === category)?.subcategories ?? [];
  const p = product;
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-4">
        <Feedback state={state} />

        <Card title="Identificação">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do produto" className="sm:col-span-2">
              <input name="name" defaultValue={p?.name} className={inputCls} required minLength={3} />
            </Field>
            <Field label="Marca" hint="Nova marca é criada automaticamente.">
              <input name="brand_name" defaultValue={p?.brand_name} className={inputCls} list="brands-list" />
              <datalist id="brands-list">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label="SKU / código">
              <input name="sku" defaultValue={p?.sku} className={inputCls} />
            </Field>
            <Field label="EAN (código de barras)">
              <input name="ean" defaultValue={p?.ean ?? ""} className={inputCls} inputMode="numeric" />
            </Field>
            <Field label="Slug (URL)" hint="Deixe vazio para gerar do nome.">
              <input name="slug" defaultValue={p?.slug ?? ""} className={inputCls} />
            </Field>
            <Field label="Categoria">
              <select name="category_slug" value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} required>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subcategoria">
              <select name="subcategory_slug" defaultValue={p?.subcategory_slug ?? ""} className={selectCls}>
                <option value="">—</option>
                {subs.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fornecedor" hint="Fornecedor parceiro responsável por este item.">
              <select name="supplier_id" defaultValue={p?.supplier_id ?? ""} className={selectCls}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unidade de venda">
              <select name="unit" defaultValue={p?.unit ?? "un"} className={selectCls}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Embalagem" hint='Ex.: "Saco 50 kg", "Caixa com 2,36 m²"'>
              <input name="pack_info" defaultValue={p?.pack_info ?? ""} className={inputCls} />
            </Field>
          </div>
        </Card>

        <Card title="Preços">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Preço varejo (R$)">
              <input name="retail_price" defaultValue={money(p?.retail_price)} className={inputCls} inputMode="decimal" required />
            </Field>
            <Field label='Preço "de" (R$)' hint="Preenchido = produto em oferta.">
              <input name="list_price" defaultValue={money(p?.list_price)} className={inputCls} inputMode="decimal" />
            </Field>
            <Field label="Desconto Pix (%)" hint="Vazio usa o padrão do site.">
              <input name="pix_discount_pct" defaultValue={money(p?.pix_discount_pct)} className={inputCls} inputMode="decimal" />
            </Field>
            <Field label="Preço atacado (R$)">
              <input name="wholesale_price" defaultValue={money(p?.wholesale_price)} className={inputCls} inputMode="decimal" />
            </Field>
            <Field label="A partir de (qtd.)">
              <input name="wholesale_min_qty" defaultValue={p?.wholesale_min_qty ?? ""} className={inputCls} inputMode="numeric" />
            </Field>
          </div>
        </Card>

        <Card title="Descrição">
          <div className="grid gap-4">
            <Field label="Resumo (aparece no card e no topo da página)">
              <textarea name="short_description" defaultValue={p?.short_description ?? ""} className={textareaCls} rows={2} />
            </Field>
            <Field label="Descrição completa">
              <textarea name="description" defaultValue={p?.description ?? ""} className={textareaCls} rows={6} />
            </Field>
            <Field label="Rendimento / dica de consumo">
              <input name="yield_hint" defaultValue={p?.yield_hint ?? ""} className={inputCls} />
            </Field>
            <Field label="Especificações" hint='Uma por linha, "Rótulo: valor". Ex.: "Peso: 50 kg"'>
              <textarea name="specs" defaultValue={(p?.specs ?? []).map((s) => `${s.label}: ${s.value}`).join("\n")} className={textareaCls} rows={5} />
            </Field>
            <Field label="Tags de busca (separadas por vírgula)">
              <input name="tags" defaultValue={(p?.tags ?? []).join(", ")} className={inputCls} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Publicação">
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={p?.active ?? true} className="size-4 accent-brand-navy" /> Produto ativo (visível na loja)
            </label>
            <Field label="Selos">
              <div className="grid grid-cols-2 gap-1.5">
                {BADGES.map((b) => (
                  <label key={b} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="badges" value={b} defaultChecked={p?.badges?.includes(b)} className="size-4 accent-brand-navy" /> {b}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Ordem (menor aparece antes)">
              <input name="sort" defaultValue={p?.sort ?? 0} className={inputCls} inputMode="numeric" />
            </Field>
          </div>
        </Card>

        <Card title="Estoque e limites">
          <div className="space-y-3 text-sm">
            <Field label="Disponibilidade">
              <select name="stock_status" defaultValue={p?.stock_status ?? "supplier"} className={selectCls}>
                <option value="supplier">Enviado pelo fornecedor</option>
                <option value="in_stock">Pronta entrega</option>
                <option value="out">Esgotado</option>
              </select>
            </Field>
            <Field label="Estoque (unidades)" hint="Vazio = sem controle. 0 = esgotado. ≤ 5 mostra “últimas unidades”.">
              <input name="stock" defaultValue={p?.stock ?? ""} className={inputCls} inputMode="numeric" />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="max_per_order_enabled" defaultChecked={p?.max_per_order_enabled} className="size-4 accent-brand-navy" /> Limitar quantidade por pedido
            </label>
            <Field label="Máximo por pedido">
              <input name="max_per_order" defaultValue={p?.max_per_order ?? ""} className={inputCls} inputMode="numeric" />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="image_manual" defaultChecked={p?.image_manual} className="size-4 accent-brand-navy" /> Foto manual (lote não sobrescreve)
            </label>
          </div>
        </Card>


        <div className="sticky bottom-4 flex flex-col gap-2 rounded-2xl border border-brand-line bg-card p-3 shadow-lg">
          <Button type="submit" variant="brand" size="lg" disabled={pending}>
            {pending ? "Salvando..." : "Salvar produto"}
          </Button>
          <Button type="submit" name="redirect" value="list" variant="outline-navy" disabled={pending}>
            Salvar e voltar à lista
          </Button>
          <Button variant="ghost" render={<Link href="/admin/produtos" />}>
            Cancelar
          </Button>
          {p ? (
            <div className="border-t border-brand-line pt-2">
              <ProductRowActions product={p} compact={false} />
            </div>
          ) : null}
        </div>
      </div>

      {p ? (
        <div className="lg:col-span-2">
          <Card title="Fotos">
            <ProductImages productId={p.id} productName={p.name} initial={p.images ?? []} manual={p.image_manual} />
          </Card>
        </div>
      ) : (
        <p className="text-xs text-brand-ink-soft lg:col-span-2">Salve o produto para enviar ou buscar fotos.</p>
      )}
    </form>
  );
}
