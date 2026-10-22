"use client";

import { useActionState, useState } from "react";
import { UserPlus, X } from "lucide-react";

import { linkUserToSupplier, unlinkUserFromSupplier, type ActionResult } from "@/app/admin/actions";
import type { LinkedProfile } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";

export function SupplierLinkedUsers({
  supplierId,
  initialProfiles,
}: {
  supplierId: string;
  initialProfiles: LinkedProfile[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [linkState, linkAction, linkPending] = useActionState(linkUserToSupplier, {});
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(unlinkUserFromSupplier, {});

  return (
    <div className="space-y-4">
      {initialProfiles.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-brand-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-ink-soft">
              <tr>
                <th className="px-4 py-2 font-semibold">Nome</th>
                <th className="px-4 py-2 font-semibold">E-mail</th>
                <th className="px-4 py-2 font-semibold">Papel</th>
                <th className="px-4 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {initialProfiles.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-medium text-brand-ink">{p.full_name || "—"}</td>
                  <td className="px-4 py-2.5 text-brand-ink-soft">{p.email}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-brand-bg px-2 py-0.5 text-[0.65rem] font-bold uppercase text-brand-ink-soft">
                      {p.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <form action={unlinkAction} className="inline">
                      <input type="hidden" name="profile_id" value={p.id} />
                      <input type="hidden" name="supplier_id" value={supplierId} />
                      <button
                        type="submit"
                        disabled={unlinkPending}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-brand-red hover:bg-brand-red/10 disabled:opacity-50"
                      >
                        <X className="size-3.5" /> Desvincular
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-brand-line bg-brand-bg px-4 py-6 text-center text-sm text-brand-ink-soft">
          Nenhum usuário vinculado a este fornecedor.
        </p>
      )}

      {unlinkState?.error && <p className="text-sm font-medium text-brand-red">{unlinkState.error}</p>}
      {unlinkState?.ok && <p className="text-sm font-medium text-brand-green">{unlinkState.ok}</p>}

      {showForm ? (
        <form action={linkAction} className="flex items-end gap-3 rounded-xl border border-brand-line bg-card p-4">
          <input type="hidden" name="supplier_id" value={supplierId} />
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-brand-ink">E-mail do usuário</span>
            <input
              name="email"
              type="email"
              required
              placeholder="usuario@exemplo.com"
              className="h-10 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink placeholder:text-brand-ink-soft/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <Button type="submit" variant="brand" disabled={linkPending}>
            {linkPending ? "Vinculando..." : "Vincular"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
            Cancelar
          </Button>
          {linkState?.error && <p className="text-sm font-medium text-brand-red">{linkState.error}</p>}
          {linkState?.ok && <p className="text-sm font-medium text-brand-green">{linkState.ok}</p>}
        </form>
      ) : (
        <Button type="button" variant="outline-navy" onClick={() => setShowForm(true)} className="gap-1.5">
          <UserPlus className="size-4" /> Vincular usuário
        </Button>
      )}
    </div>
  );
}
