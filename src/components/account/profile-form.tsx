"use client";

import { useActionState, useState } from "react";

import { updatePassword, updateProfile, type ActionState } from "@/app/conta/actions";
import { Button } from "@/components/ui/button";
import { maskDocument, maskPhone } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">{state.ok}</p>;
  return null;
}

export function ProfileForm({ fullName, document, phone, email }: { fullName: string; document: string | null; phone: string | null; email: string }) {
  const [state, action, pending] = useActionState(updateProfile, {});
  const [doc, setDoc] = useState(document ? maskDocument(document) : "");
  const [tel, setTel] = useState(phone ?? "");
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-brand-line bg-card p-6">
      <Feedback state={state} />
      <label className="block text-xs font-semibold text-brand-ink">
        Nome completo
        <input name="full_name" defaultValue={fullName} className={cn(input, "mt-1")} autoComplete="name" required />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-brand-ink">
          CPF ou CNPJ
          <input name="document" value={doc} onChange={(e) => setDoc(maskDocument(e.target.value))} className={cn(input, "mt-1")} inputMode="numeric" />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          WhatsApp
          <input name="phone" value={tel} onChange={(e) => setTel(maskPhone(e.target.value))} className={cn(input, "mt-1")} inputMode="tel" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-brand-ink">
        E-mail (login)
        <input value={email} readOnly className={cn(input, "mt-1 bg-muted text-brand-ink-soft")} />
      </label>
      <Button type="submit" variant="brand" size="lg" disabled={pending}>
        {pending ? "Salvando..." : "Salvar dados"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {});
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-brand-line bg-card p-6">
      <Feedback state={state} />
      <label className="block text-xs font-semibold text-brand-ink">
        Nova senha (mínimo 8 caracteres)
        <input name="password" type="password" className={cn(input, "mt-1")} autoComplete="new-password" minLength={8} required />
      </label>
      <label className="block text-xs font-semibold text-brand-ink">
        Confirmar nova senha
        <input name="confirm" type="password" className={cn(input, "mt-1")} autoComplete="new-password" minLength={8} required />
      </label>
      <Button type="submit" variant="brand" size="lg" disabled={pending}>
        {pending ? "Salvando..." : "Salvar nova senha"}
      </Button>
    </form>
  );
}
