"use client";

import { EditableList } from "@/components/admin/editable-list";
import { CategoryForm, SupplierForm } from "@/components/admin/settings-forms";
import type { AdminCategory, AdminSupplier } from "@/lib/admin/types";
import { maskCNPJ } from "@/lib/utils/masks";

export function SuppliersAdmin({ suppliers }: { suppliers: AdminSupplier[] }) {
  return (
    <EditableList
      items={suppliers.map((s) => ({ ...s, key: s.id }))}
      newLabel="Novo fornecedor"
      renderRow={(s) => (
        <>
          <p className="font-semibold text-brand-ink">
            {s.name} {!s.active ? <span className="ml-1 rounded bg-muted px-1 text-[0.65rem] font-bold">INATIVO</span> : null}
          </p>
          <p className="text-xs text-brand-ink-soft">
            {s.city ?? "—"} · despacho {s.lead_time_days} dia(s) · {s.cnpj ? maskCNPJ(s.cnpj) : "sem CNPJ"} · {s.contact_name ?? ""} {s.contact_phone ?? ""}
          </p>
        </>
      )}
      renderForm={(s, done) => <SupplierForm supplier={s} onDone={done} />}
    />
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
