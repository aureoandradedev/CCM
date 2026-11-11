"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Lista com "Editar" inline + "Novo" (fornecedores, categorias). */
export function EditableList<T extends { key: string }>({ items, renderRow, renderForm, newLabel }: { items: T[]; renderRow: (item: T) => React.ReactNode; renderForm: (item: T | null, onDone: () => void) => React.ReactNode; newLabel?: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.key} className="rounded-2xl border border-brand-line bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">{renderRow(it)}</div>
            <Button size="sm" variant="outline" onClick={() => setEditing(editing === it.key ? null : it.key)}>
              {editing === it.key ? "Fechar" : "Editar"}
            </Button>
          </div>
          {editing === it.key ? <div className="mt-3">{renderForm(it, () => setEditing(null))}</div> : null}
        </div>
      ))}
      {newLabel && (
        novo ? (
          renderForm(null, () => setNovo(false))
        ) : (
          <Button variant="navy" size="sm" onClick={() => setNovo(true)}>
            <Plus /> {newLabel}
          </Button>
        )
      )}
    </div>
  );
}
