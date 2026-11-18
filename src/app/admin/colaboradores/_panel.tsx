"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Search, Shield, ShieldOff, UserPlus, X } from "lucide-react";

import { setCollaborator, searchUserByEmail, type ColabState } from "./actions";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  compras: "Compras",
  recebedor: "Recebedor",
  operacao: "Operação / Separação",
  entregador: "Entregador",
  customer: "Cliente",
};

const OP_ROLES = ["admin", "compras", "recebedor", "operacao", "entregador"] as const;

type Collaborator = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  phone: string | null;
  created_at: string;
};

export function ColaboradoresPanel({ initialData }: { initialData: Collaborator[] }) {
  const [list, setList] = useState(initialData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-muted-foreground">{list.length} colaborador(es)</p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy/90"
        >
          <UserPlus className="size-3.5" /> Adicionar colaborador
        </button>
      </div>

      {showAdd && (
        <AddCollaboratorForm
          onDone={(c) => {
            if (c) setList((prev) => [...prev.filter((p) => p.id !== c.id), c].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
            setShowAdd(false);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-brand-line">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Função</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-line">
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">{c.full_name || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                <td className="px-4 py-3">
                  {editingId === c.id ? (
                    <EditRoleForm
                      collaborator={c}
                      onDone={(updated) => {
                        if (updated) setList((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs font-semibold text-brand-navy">
                      {ROLE_LABELS[c.role] ?? c.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.is_active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                      <Shield className="size-3" /> Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                      <ShieldOff className="size-3" /> Inativo
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {editingId !== c.id && (
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="text-xs font-semibold text-brand-blue underline hover:no-underline"
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum colaborador operacional cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRoleForm({ collaborator, onDone }: { collaborator: Collaborator; onDone: (c: Collaborator | null) => void }) {
  const [role, setRole] = useState(collaborator.role);
  const [active, setActive] = useState(collaborator.is_active);
  const [state, formAction] = useActionState(async (_prev: ColabState, fd: FormData) => {
    const res = await setCollaborator(_prev, fd);
    if (res.ok) onDone({ ...collaborator, role, is_active: active });
    return res;
  }, {} as ColabState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="profile_id" value={collaborator.id} />
      <input type="hidden" name="is_active" value={active ? "true" : "false"} />
      <select
        name="role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded border border-brand-line px-2 py-1 text-xs"
      >
        {OP_ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Ativo
      </label>
      <button type="submit" className="rounded bg-green-600 p-1 text-white hover:bg-green-700" title="Salvar">
        <Check className="size-3.5" />
      </button>
      <button type="button" onClick={() => onDone(null)} className="rounded bg-gray-200 p-1 hover:bg-gray-300" title="Cancelar">
        <X className="size-3.5" />
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

function AddCollaboratorForm({ onDone }: { onDone: (c: Collaborator | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string | null; email: string; role: string; is_active: boolean }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState("compras");
  const [searching, startSearch] = useTransition();
  const [state, formAction] = useActionState(async (_prev: ColabState, fd: FormData) => {
    const res = await setCollaborator(_prev, fd);
    if (res.ok) {
      const match = results.find((r) => r.id === selected);
      if (match) onDone({ ...match, role, is_active: true, phone: null, created_at: new Date().toISOString() });
    }
    return res;
  }, {} as ColabState);

  const doSearch = () => {
    if (query.length < 3) return;
    startSearch(async () => {
      const r = await searchUserByEmail(query);
      setResults(r);
    });
  };

  return (
    <div className="rounded-lg border border-brand-line bg-card p-4 space-y-3">
      <p className="text-sm font-semibold">Buscar usuário por e-mail</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), doSearch())}
          placeholder="Digite parte do e-mail..."
          className="flex-1 rounded border border-brand-line px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={doSearch}
          disabled={searching || query.length < 3}
          className="inline-flex items-center gap-1 rounded bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Search className="size-3.5" /> Buscar
        </button>
        <button type="button" onClick={() => onDone(null)} className="rounded px-3 py-1.5 text-xs hover:bg-gray-100">
          Cancelar
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r) => (
            <label
              key={r.id}
              className={`flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm ${selected === r.id ? "bg-brand-navy/10" : "hover:bg-muted/30"}`}
            >
              <input type="radio" name="select_user" checked={selected === r.id} onChange={() => setSelected(r.id)} className="accent-brand-navy" />
              <span className="font-medium">{r.full_name || "Sem nome"}</span>
              <span className="text-muted-foreground">· {r.email}</span>
              <span className="ml-auto text-xs text-muted-foreground">{ROLE_LABELS[r.role] ?? r.role}</span>
            </label>
          ))}
        </div>
      )}

      {selected && (
        <form action={formAction} className="flex items-center gap-3 border-t border-brand-line pt-3">
          <input type="hidden" name="profile_id" value={selected} />
          <input type="hidden" name="is_active" value="true" />
          <label className="text-xs font-semibold">
            Função:
            <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="ml-2 rounded border px-2 py-1 text-xs">
              {OP_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-brand-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90">
            Definir como colaborador
          </button>
          {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        </form>
      )}

      {results.length === 0 && query.length >= 3 && !searching && (
        <p className="text-xs text-muted-foreground">Nenhum resultado. O usuário precisa ter uma conta criada primeiro.</p>
      )}
    </div>
  );
}
