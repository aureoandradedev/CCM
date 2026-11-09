"use client";

import { useActionState } from "react";

import { Feedback } from "@/components/admin/ui";
import { approvePriceChange, rejectPriceChange } from "../ccm-actions";
import type { ActionResult } from "../ccm-actions";

export function PriceActionButtons({ logId }: { logId: string }) {
  const [approveState, approveAction, approvePending] = useActionState<ActionResult, FormData>(
    approvePriceChange,
    {},
  );
  const [rejectState, rejectAction, rejectPending] = useActionState<ActionResult, FormData>(
    rejectPriceChange,
    {},
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <form action={approveAction}>
          <input type="hidden" name="logId" value={logId} />
          <button
            type="submit"
            disabled={approvePending}
            className="rounded-lg bg-brand-green px-3 py-1 text-xs font-bold text-white hover:bg-brand-green/90"
          >
            Aprovar
          </button>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="logId" value={logId} />
          <input type="hidden" name="action" value="deactivate" />
          <button
            type="submit"
            disabled={rejectPending}
            className="rounded-lg bg-brand-red/20 px-3 py-1 text-xs font-bold text-brand-red hover:bg-brand-red/30"
          >
            Tirar da venda
          </button>
        </form>
      </div>
      <Feedback state={approveState} />
      <Feedback state={rejectState} />
    </div>
  );
}
