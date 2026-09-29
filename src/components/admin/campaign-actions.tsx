"use client";

import { Play, Square, XCircle } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { activateCampaign, cancelCampaign, endCampaign, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminCampaign } from "@/lib/admin/types";

export function CampaignActions({ campaign }: { campaign: AdminCampaign }) {
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else toast.success(r.ok ?? "Feito.");
    });
  return (
    <div className="flex flex-wrap gap-2">
      {campaign.status === "agendada" ? (
        <>
          <Button size="sm" variant="brand" disabled={pending} onClick={() => go(() => activateCampaign(campaign.id))}>
            <Play /> Ativar agora
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => window.confirm("Cancelar esta campanha?") && go(() => cancelCampaign(campaign.id))}>
            <XCircle /> Cancelar
          </Button>
        </>
      ) : null}
      {campaign.status === "ativa" ? (
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => window.confirm("Encerrar e restaurar os preços originais?") && go(() => endCampaign(campaign.id))}>
          <Square /> Encerrar
        </Button>
      ) : null}
    </div>
  );
}
