"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { removeMyOrderItem } from "@/app/conta/actions";
import type { OrderItemRow } from "@/lib/orders";
import { formatUnit } from "@/lib/utils/format";

export function CustomerRemoveItem({
  orderId,
  items,
}: {
  orderId: string;
  items: OrderItemRow[];
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const removable = items.filter((i) => i.qty > 0);
  if (removable.length <= 1) return null;

  const handleRemove = (item: OrderItemRow) => {
    setRemoving(item.id);
    startTransition(async () => {
      const r = await removeMyOrderItem(orderId, item.id, "Removido pelo cliente");
      if (r.error) {
        toast.error(r.error);
        setRemoving(null);
      } else {
        toast.success(r.ok);
        setRemoving(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-2xl border border-brand-line bg-card p-5">
      <p className="font-heading text-sm font-bold text-brand-navy">
        Remover item do pedido
      </p>
      <p className="mt-0.5 text-xs text-brand-ink-soft">
        Remova itens que nao deseja mais. Se restar apenas um item, ele nao pode
        ser removido (cancele o pedido).
      </p>
      <ul className="mt-3 divide-y divide-brand-line">
        {removable.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-brand-ink">
              {it.name}{" "}
              <span className="text-brand-ink-soft">
                ({it.qty} {formatUnit(it.unit)})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-brand-red hover:bg-brand-red/10"
              disabled={pending}
              onClick={() => handleRemove(it)}
            >
              {removing === it.id && pending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Remover
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
