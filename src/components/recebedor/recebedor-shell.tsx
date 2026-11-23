"use client";

import { ClipboardCheck } from "lucide-react";
import { OperationalShell } from "@/components/operational/operational-shell";

export function RecebedorShell({ children, userName }: { children: React.ReactNode; userName: string }) {
  return (
    <OperationalShell area="Recebimento" areaIcon={<ClipboardCheck className="size-4" />} userName={userName}>
      {children}
    </OperationalShell>
  );
}
