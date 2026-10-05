"use client";

import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PaymentStep } from "@/components/checkout/payment-step";
import { Button } from "@/components/ui/button";

/** "Pagar agora" para pedido em aguardando-pagamento (Pix expirado, cartão recusado, etc.). */
export function PayNow({ orderId, orderCode, totalCentavos, pricingVersion, metodo }: { orderId: string; orderCode: string; totalCentavos: number; pricingVersion: number; metodo: "pix" | "cartao" }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-yellow bg-brand-yellow-soft p-4">
        <p className="text-sm font-semibold text-brand-navy">Este pedido ainda não foi pago.</p>
        <Button variant="brand" onClick={() => setAberto(true)}>
          <CreditCard /> Pagar agora
        </Button>
      </div>
    );
  }

  return (
    <PaymentStep
      pedido={{ orderId, orderCode, pricingVersion, totais: { totalCentavos, discountCentavos: 0, freightCentavos: 0, subtotalCentavos: 0 } }}
      metodo={metodo}
      onPaid={() => {
        toast.success("Pagamento confirmado!");
        router.refresh();
        setAberto(false);
      }}
    />
  );
}
