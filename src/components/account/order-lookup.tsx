"use client";

import { PackageSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isValidCNPJ, isValidCPF, maskDocument } from "@/lib/utils/masks";
import { formatBRL } from "@/lib/utils/format";

interface StoredOrder {
  code: string;
  createdAt: string;
  customer: { nome: string; documento: string };
  lines: { productId: string; name: string; qty: number }[];
  totals: { total: number };
  payment: string;
}

/** Consulta de pedido por documento + código (mesma ideia do "Meus pedidos" do Multigiro). */
export function OrderLookup() {
  const [doc, setDoc] = useState("");
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<StoredOrder | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidCPF(doc) && !isValidCNPJ(doc)) {
      toast.error("CPF ou CNPJ inválido.");
      return;
    }
    const key = `ccm_order_${code.trim().toUpperCase()}`;
    let found: StoredOrder | null = null;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) found = JSON.parse(raw) as StoredOrder;
    } catch {}
    if (!found || found.customer.documento !== doc.replace(/\D+/g, "")) {
      setOrder(null);
      toast.error("Pedido não encontrado para este documento.", { description: "A consulta no banco de pedidos entra na próxima fase." });
      return;
    }
    setOrder(found);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <form onSubmit={submit} className="space-y-4 rounded-3xl border border-brand-line bg-card p-6">
        <label className="block text-xs font-semibold text-brand-ink">
          CPF ou CNPJ
          <input
            className="mt-1 h-11 w-full rounded-lg border border-brand-line bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            inputMode="numeric"
            value={doc}
            onChange={(e) => setDoc(maskDocument(e.target.value))}
            required
          />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          Número do pedido
          <input
            className="mt-1 h-11 w-full rounded-lg border border-brand-line bg-background px-3 text-sm uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="CCM-XXXXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <Button type="submit" variant="brand" size="lg" className="w-full">
          <PackageSearch />
          Buscar pedido
        </Button>
      </form>

      {order ? (
        <div className="rounded-3xl border border-brand-line bg-card p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Pedido</p>
          <p className="font-heading text-2xl font-extrabold text-brand-navy dark:text-foreground">{order.code}</p>
          <p className="text-sm text-brand-ink-soft">
            {new Date(order.createdAt).toLocaleString("pt-BR")} · {order.customer.nome} · pagamento: {order.payment}
          </p>
          <span className="mt-3 inline-flex rounded-full bg-brand-yellow-soft px-3 py-1 text-xs font-bold text-brand-navy dark:text-foreground">Aguardando confirmação do fornecedor</span>
          <ul className="mt-4 divide-y divide-brand-line text-sm">
            {order.lines.map((l) => (
              <li key={l.productId} className="flex justify-between py-2">
                <span>
                  <strong>{l.qty}×</strong> {l.name}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-right font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">Total {formatBRL(order.totals.total)}</p>
        </div>
      ) : null}
    </div>
  );
}
