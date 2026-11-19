"use client";

import { useActionState, useState } from "react";
import { Check, Shield, ShieldOff, UserPlus, X } from "lucide-react";

import { setCollaborator, createCollaborator, type ColabState } from "./actions";

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
        <CreateCollaboratorForm
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

function CreateCollaboratorForm({ onDone }: { onDone: (c: Collaborator | null) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("compras");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, formAction] = useActionState(async (_prev: ColabState, fd: FormData) => {
    const res = await createCollaborator(_prev, fd);
    if (res.ok) {
      onDone({
        id: crypto.randomUUID(),
        full_name: fullName,
        email: email.toLowerCase().trim(),
        role,
        is_active: true,
        phone: null,
        created_at: new Date().toISOString(),
      });
    }
    return res;
  }, {} as ColabState);

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <div className="rounded-lg border border-brand-line bg-card p-4 space-y-3">
      <p className="text-sm font-semibold">Criar conta de colaborador</p>

      <form action={formAction} className="space-y-3">
        <label className="block text-xs font-semibold text-brand-ink">
          Nome completo
          <input
            type="text"
            name="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-brand-line px-3 py-1.5 text-sm"
            placeholder="Ex: João da Silva"
          />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          E-mail
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-brand-line px-3 py-1.5 text-sm"
            placeholder="colaborador@empresa.com"
          />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Função
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 block w-full rounded border border-brand-line px-3 py-1.5 text-sm"
          >
            {OP_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Senha inicial
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="mt-1 block w-full rounded border border-brand-line px-3 py-1.5 text-sm"
          />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Confirmar senha
          <input
            type="password"
            name="confirm_password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className={`mt-1 block w-full rounded border px-3 py-1.5 text-sm ${passwordMismatch ? "border-red-400" : "border-brand-line"}`}
          />
          {passwordMismatch && (
            <span className="mt-1 text-xs text-red-600">As senhas não conferem.</span>
          )}
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={passwordMismatch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50"
          >
            <UserPlus className="size-3.5" /> Criar colaborador
          </button>
          <button type="button" onClick={() => onDone(null)} className="rounded px-3 py-2 text-xs hover:bg-gray-100">
            Cancelar
          </button>
        </div>

        {state.error && (
          <p className="rounded bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{state.error}</p>
        )}
        {state.ok && (
          <p className="rounded bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">{state.ok}</p>
        )}
      </form>
    </div>
  );
}
