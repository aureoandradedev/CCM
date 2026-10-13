"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canonicalProductSchema } from "@/lib/integrations/validate";
import type { CanonicalProduct, ImportSummary, RowResult } from "@/lib/integrations/types";
import { parseNumberBR } from "@/lib/integrations/mapping";
import { cn } from "@/lib/utils";

const inputCls =
  "h-10 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink placeholder:text-brand-ink-soft/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function summarize(products: CanonicalProduct[]): ImportSummary {
  const rows: RowResult[] = products.map((p, index) => ({ index, raw: {}, product: p, errors: [], warnings: [] }));
  return {
    total: products.length,
    valid: products.length,
    invalid: 0,
    warnings: 0,
    withStock: products.filter((p) => p.stock > 0).length,
    withPrice: products.filter((p) => p.price > 0).length,
    withImages: products.filter((p) => (p.images?.length ?? 0) > 0).length,
    rows,
  };
}

const EMPTY = { sku: "", name: "", price: "", stock: "", brand: "", category: "", unit: "" };

export function ManualImporter({ onChange }: { onChange: (summary: ImportSummary | null) => void }) {
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChange(products.length ? summarize(products) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  function add() {
    setError(null);
    const draft = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      price: parseNumberBR(form.price),
      stock: (() => {
        const n = parseNumberBR(form.stock);
        return n == null ? null : Math.trunc(n);
      })(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || undefined,
      unit: form.unit.trim() || undefined,
    };
    const parsed = canonicalProductSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Preencha os campos obrigatórios.");
      return;
    }
    setProducts((p) => [...p, parsed.data as CanonicalProduct]);
    setForm({ ...EMPTY });
  }

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">SKU / Código <span className="text-brand-red">*</span></span>
          <input className={inputCls} value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Ex.: CIM-50" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-1 lg:col-span-2">
          <span className="text-xs font-semibold text-brand-ink">Nome <span className="text-brand-red">*</span></span>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Cimento CP-II 50kg" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Preço (R$) <span className="text-brand-red">*</span></span>
          <input className={inputCls} value={form.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" placeholder="39,90" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Estoque <span className="text-brand-red">*</span></span>
          <input className={inputCls} value={form.stock} onChange={(e) => set("stock", e.target.value)} inputMode="numeric" placeholder="120" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Unidade</span>
          <input className={inputCls} value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="un, cx, kg, m²" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Marca</span>
          <input className={inputCls} value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Ex.: Votoran" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Categoria</span>
          <input className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Ex.: Materiais Básicos" />
        </label>
      </div>
      {error ? <p className="text-sm font-medium text-brand-red">{error}</p> : null}
      <Button type="button" variant="navy" onClick={add} className="gap-1">
        <Plus className="size-4" /> Adicionar produto
      </Button>

      {products.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-brand-line">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-ink-soft">
              <tr>
                <th className="px-3 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold">Nome</th>
                <th className="px-3 py-2 font-semibold">Preço</th>
                <th className="px-3 py-2 font-semibold">Estoque</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {products.map((p, i) => (
                <tr key={`${p.sku}-${i}`}>
                  <td className="px-3 py-2 font-medium text-brand-ink">{p.sku}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-brand-ink">{p.name}</td>
                  <td className="px-3 py-2 tabular-nums text-brand-ink">{p.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                  <td className="px-3 py-2 tabular-nums text-brand-ink">{p.stock}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setProducts((list) => list.filter((_, idx) => idx !== i))}
                      className={cn("press text-brand-ink-soft hover:text-brand-red")}
                      aria-label="Remover"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-brand-ink-soft">Nenhum produto adicionado ainda. Preencha acima e clique em “Adicionar produto”.</p>
      )}
    </div>
  );
}
