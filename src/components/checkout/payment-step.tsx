"use client";

import { CreditCard, QrCode } from "lucide-react";
import { useState } from "react";

import { CardPanel } from "@/components/checkout/card-panel";
import { PixPanel } from "@/components/checkout/pix-panel";
import { cn } from "@/lib/utils";

export interface PedidoCriado {
  orderId: string;
  orderCode: string;
  pricingVersion: number;
  totais: { totalCentavos: number; discountCentavos: number; freightCentavos: number; subtotalCentavos: number };
}

/** Etapa de pagamento depois do pedido criado: Pix (QR) ou cartão (SOP). */
export function PaymentStep({ pedido, metodo, onPaid, permitirTrocar = true }: { pedido: PedidoCriado; metodo: "pix" | "cartao"; onPaid: () => void; permitirTrocar?: boolean }) {
  const [atual, setAtual] = useState<"pix" | "cartao">(metodo);

  return (
    <div className="rounded-3xl border border-brand-line bg-card p-5 md:p-6">
      {permitirTrocar ? (
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Forma de pagamento">
          {(
            [
              ["pix", "Pix", QrCode],
              ["cartao", "Cartão", CreditCard],
            ] as const
          ).map(([k, label, I]) => (
            <button
              key={k}
              role="tab"
              aria-selected={atual === k}
              type="button"
              onClick={() => setAtual(k)}
              className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors", atual === k ? "bg-card text-brand-navy shadow-sm" : "text-brand-ink-soft hover:text-brand-ink")}
            >
              <I className="size-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}

      {atual === "pix" ? (
        <PixPanel orderId={pedido.orderId} orderCode={pedido.orderCode} totalCentavos={pedido.totais.totalCentavos} pricingVersion={pedido.pricingVersion} onPaid={onPaid} />
      ) : (
        <CardPanel orderId={pedido.orderId} orderCode={pedido.orderCode} totalCentavos={pedido.totais.totalCentavos} pricingVersion={pedido.pricingVersion} onPaid={onPaid} />
      )}
    </div>
  );
}
