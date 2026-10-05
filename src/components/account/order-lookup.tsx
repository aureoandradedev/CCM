"use client";

import { PackageSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { OrderDetail } from "@/components/account/order-detail";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import type { OrderItemRow, OrderRow } from "@/lib/orders";
import { isValidCNPJ, isValidCPF, maskDocument, onlyDigits } from "@/lib/utils/masks";

/** Consulta de pedido sem login: CPF/CNPJ + código (backend valida os dois). */
export function OrderLookup() {
  const [doc, setDoc] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ order: OrderRow; items: OrderItemRow[] } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidCPF(doc) && !isValidCNPJ(doc)) {
      toast.error("CPF ou CNPJ inválido.");
      return;
    }
    setPending(true);
    try {
      const r = await apiFetch<{ order: OrderRow; items: OrderItemRow[] }>("/pagamentos/consultar-pedido", { body: { document: onlyDigits(doc), code: code.trim().toUpperCase() }, auth: false });
      setResult(r);
    } catch (err) {
      setResult(null);
      toast.error((err as ApiError).message || "Pedido não encontrado.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="grid gap-4 rounded-3xl border border-brand-line bg-card p-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-xs font-semibold text-brand-ink">
          CPF ou CNPJ
          <input className="mt-1 h-11 w-full rounded-lg border border-brand-line bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" inputMode="numeric" value={doc} onChange={(e) => setDoc(maskDocument(e.target.value))} required />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          Número do pedido
          <input className="mt-1 h-11 w-full rounded-lg border border-brand-line bg-background px-3 text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="AB1234" value={code} onChange={(e) => setCode(e.target.value)} required />
        </label>
        <Button type="submit" variant="brand" size="lg" disabled={pending}>
          <PackageSearch />
          {pending ? "Buscando..." : "Buscar"}
        </Button>
      </form>

      {result ? (
        <div>
          <h2 className="mb-4 font-heading text-2xl font-extrabold text-brand-navy">Pedido {result.order.code}</h2>
          <OrderDetail order={result.order} items={result.items} />
        </div>
      ) : null}
    </div>
  );
}
