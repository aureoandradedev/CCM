"use client";

import { useState, useTransition } from "react";
import { toggleAutoPromote } from "@/app/admin/actions";

export function AutoPromoteToggle({
  supplierId,
  initialEnabled,
}: {
  supplierId: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  function handleChange() {
    const next = !enabled;
    setEnabled(next);
    setMsg(null);
    startTransition(async () => {
      const r = await toggleAutoPromote(supplierId, next);
      setMsg(r);
    });
  }

  return (
    <div className="rounded-2xl border border-brand-line bg-card px-4 py-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-brand-navy dark:text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleChange}
          disabled={pending}
          className="size-4 accent-brand-navy"
        />
        Promoção automática
      </label>
      <p className="mt-1 text-xs text-brand-ink-soft">
        Quando ativado, produtos que tiverem redução de preço via troca automática de fornecedor
        recebem badge &quot;oferta&quot; e o preço anterior vira preço riscado.
      </p>
      {msg?.ok && <p className="mt-1 text-xs text-green-600">{msg.ok}</p>}
      {msg?.error && <p className="mt-1 text-xs text-red-600">{msg.error}</p>}
    </div>
  );
}
