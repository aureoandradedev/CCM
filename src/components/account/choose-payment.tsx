"use client";

import { useState } from "react";
import { CreditCard, QrCode } from "lucide-react";

import { PayNow } from "./pay-now";

export function ChoosePayment({ orderId, orderCode, totalCentavos, pricingVersion }: {
  orderId: string;
  orderCode: string;
  totalCentavos: number;
  pricingVersion: number;
}) {
  const [metodo, setMetodo] = useState<"pix" | "cartao" | null>(null);

  if (metodo) {
    return <PayNow orderId={orderId} orderCode={orderCode} totalCentavos={totalCentavos} pricingVersion={pricingVersion} metodo={metodo} />;
  }

  return (
    <div className="rounded-2xl border border-brand-green/30 bg-brand-green-soft p-5">
      <p className="font-heading font-bold text-brand-navy">Pagamento liberado!</p>
      <p className="mt-1 text-sm text-brand-ink-soft">Escolha a forma de pagamento para concluir seu pedido.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMetodo("pix")}
          className="flex items-center gap-3 rounded-xl border border-brand-line bg-card p-4 text-left transition-colors hover:border-brand-green hover:bg-brand-green-soft"
        >
          <QrCode className="size-8 text-brand-green" />
          <div>
            <p className="font-heading font-bold text-brand-navy">Pix</p>
            <p className="text-xs text-brand-ink-soft">Pagamento instantâneo</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMetodo("cartao")}
          className="flex items-center gap-3 rounded-xl border border-brand-line bg-card p-4 text-left transition-colors hover:border-brand-blue hover:bg-blue-50"
        >
          <CreditCard className="size-8 text-brand-blue" />
          <div>
            <p className="font-heading font-bold text-brand-navy">Cartão</p>
            <p className="text-xs text-brand-ink-soft">Crédito ou débito</p>
          </div>
        </button>
      </div>
    </div>
  );
}
