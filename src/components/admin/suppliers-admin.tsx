"use client";

import Link from "next/link";
import { Pencil, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { EditableList } from "@/components/admin/editable-list";
import { CategoryForm, SupplierForm } from "@/components/admin/settings-forms";
import { inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AdminCategory, AdminSupplier } from "@/lib/admin/types";
import { maskCNPJ } from "@/lib/utils/masks";

function SupplierStatusBadge({ supplier, hasActiveTerms }: { supplier: AdminSupplier; hasActiveTerms: boolean }) {
  if (!supplier.active) {
    return <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold text-brand-ink-soft">Inativo</span>;
  }
  if (hasActiveTerms) {
    return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-green-800 dark:bg-green-900/30 dark:text-green-400">Operacional</span>;
  }
  return <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Cadastro incompleto</span>;
}

function NewSupplierDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="navy" size="sm" />}>
        <Plus className="size-4" /> Novo fornecedor
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>Preencha os dados cadastrais. Condições comerciais são definidas na ficha.</DialogDescription>
        </DialogHeader>
        <SupplierForm supplier={null} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

const digits = (s: string) => s.replace(/\D/g, "");

function matchesSearch(s: AdminSupplier, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  if (s.name.toLowerCase().includes(lower)) return true;
  if (s.trade_name?.toLowerCase().includes(lower)) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 3 && s.cnpj && digits(s.cnpj).includes(qDigits)) return true;
  if (s.cnpj?.toLowerCase().includes(lower)) return true;
  return false;
}

export function SuppliersAdmin({ suppliers, supplierIdsWithTerms }: { suppliers: AdminSupplier[]; supplierIdsWithTerms: string[] }) {
  const termsSet = new Set(supplierIdsWithTerms);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => suppliers.filter((s) => matchesSearch(s, query.trim())), [suppliers, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NewSupplierDialog />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input
            type="search"
            placeholder="Buscar por nome, razão social ou CNPJ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputCls} pl-9`}
          />
        </div>
      </div>
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-brand-line bg-card p-6 text-center text-sm text-brand-ink-soft">
            {query.trim() ? `Nenhum fornecedor encontrado para "${query.trim()}".` : "Nenhum fornecedor cadastrado."}
          </p>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className="rounded-2xl border border-brand-line bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/fornecedores/${s.id}`} className="font-semibold text-brand-navy hover:underline dark:text-foreground">
                      {s.name}
                    </Link>
                    <SupplierStatusBadge supplier={s} hasActiveTerms={termsSet.has(s.id)} />
                  </div>
                  <p className="text-xs text-brand-ink-soft">
                    {s.city ?? "—"} · despacho {s.lead_time_days} dia(s) · {s.cnpj ? maskCNPJ(s.cnpj) : "sem CNPJ"} · {s.contact_name ?? ""} {s.contact_phone ?? ""}
                  </p>
                </div>
                <Link
                  href={`/admin/fornecedores/${s.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-ink-soft transition-colors hover:border-brand-navy hover:text-brand-navy"
                >
                  <Pencil className="size-3" /> Editar
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function CategoriesAdmin({ categories }: { categories: AdminCategory[] }) {
  return (
    <EditableList
      items={categories.map((c) => ({ ...c, key: c.slug }))}
      newLabel="Nova categoria"
      renderRow={(c) => (
        <>
          <p className="font-semibold text-brand-ink">
            {c.name} <span className="text-xs font-normal text-brand-ink-soft">/{c.slug}</span>
            {!c.active ? <span className="ml-1 rounded bg-muted px-1 text-[0.65rem] font-bold">INATIVA</span> : null}
          </p>
          <p className="truncate text-xs text-brand-ink-soft">{c.subcategories.map((s) => s.name).join(" · ") || "sem subcategorias"}</p>
        </>
      )}
      renderForm={(c, done) => <CategoryForm category={c} onDone={done} />}
    />
  );
}
