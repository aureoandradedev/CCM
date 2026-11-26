"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptBackupDeliveryDate } from "@/app/conta/actions";

export function AcceptBackupDate({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleAccept = () => {
    startTransition(async () => {
      const r = await acceptBackupDeliveryDate(orderId);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-2xl border border-brand-orange/30 bg-brand-orange-soft p-5">
      <div className="flex items-start gap-3">
        <Calendar className="mt-0.5 size-5 shrink-0 text-brand-orange" />
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold text-brand-navy">Prazo de entrega atualizado</p>
          <p className="mt-0.5 text-sm text-brand-ink-soft">
            O prazo de entrega do seu pedido foi ajustado por conta de disponibilidade de estoque.
            Aceite o novo prazo para liberar o pagamento.
          </p>
          <div className="mt-4">
            <Button variant="brand" size="sm" disabled={pending} onClick={handleAccept}>
              {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {pending ? "Processando..." : "Aceitar novo prazo e liberar pagamento"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
