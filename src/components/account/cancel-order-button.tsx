"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { toast } from "sonner";

import { cancelMyOrder } from "@/app/conta/actions";
import { Button } from "@/components/ui/button";

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleCancel() {
    setPending(true);
    const r = await cancelMyOrder(orderId);
    setPending(false);
    if (r.error) {
      toast.error(r.error);
    } else {
      toast.success(r.ok);
      router.refresh();
    }
  }

  if (!confirming) {
    return (
      <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        <XCircle className="size-4" /> Cancelar pedido
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-red/20 bg-brand-red/5 p-3">
      <p className="flex-1 text-sm text-brand-red">Tem certeza que deseja cancelar este pedido?</p>
      <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Voltar
      </Button>
      <Button variant="destructive" size="sm" onClick={handleCancel} disabled={pending}>
        {pending ? "Cancelando..." : "Sim, cancelar"}
      </Button>
    </div>
  );
}
