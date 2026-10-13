"use client";

import { useState, useTransition } from "react";

import { exportMyData, requestAccountDeletion } from "@/app/conta/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ExportDataButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleExport() {
    setError("");
    startTransition(async () => {
      const result = await exportMyData();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.data) return;
      const blob = new Blob([result.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meus-dados-ccm-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">{error}</p>}
      <Button type="button" variant="outline" onClick={handleExport} disabled={pending}>
        {pending ? "Preparando..." : "Baixar meus dados"}
      </Button>
    </div>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);

  const canDelete = confirm === email;

  function handleDelete() {
    if (!canDelete) return;
    setError("");
    startTransition(async () => {
      const result = await requestAccountDeletion();
      if (result?.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="border-brand-red/30 text-brand-red hover:bg-brand-red/5" onClick={() => setOpen(true)}>
        Solicitar exclusão da conta
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-red/20 bg-brand-red/5 p-4">
      <p className="text-sm font-semibold text-brand-red">Tem certeza?</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-brand-ink-soft">
        <li>Seus dados pessoais (nome, CPF/CNPJ, telefone, e-mail, endereços) serão removidos.</li>
        <li>Pedidos existentes terão os dados pessoais anonimizados. O histórico operacional será preservado quando necessário por obrigação legal, fiscal, regulatória ou para defesa de direitos.</li>
        <li>Essa ação não pode ser desfeita.</li>
      </ul>
      {error && <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">{error}</p>}
      <label className="block text-xs font-semibold text-brand-ink">
        Digite <span className="font-mono">{email}</span> para confirmar:
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cn(input, "mt-1")} autoComplete="off" spellCheck={false} />
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => { setOpen(false); setConfirm(""); }}>
          Cancelar
        </Button>
        <Button type="button" variant="destructive" disabled={!canDelete || pending} onClick={handleDelete}>
          {pending ? "Processando..." : "Confirmar exclusão"}
        </Button>
      </div>
    </div>
  );
}
