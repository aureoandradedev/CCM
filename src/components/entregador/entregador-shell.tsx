"use client";

import { Truck } from "lucide-react";
import { OperationalShell } from "@/components/operational/operational-shell";

export function EntregadorShell({ children, userName }: { children: React.ReactNode; userName: string }) {
  return (
    <OperationalShell area="Entregas" areaIcon={<Truck className="size-4" />} userName={userName}>
      {children}
    </OperationalShell>
  );
}
