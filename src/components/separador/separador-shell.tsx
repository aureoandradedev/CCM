"use client";

import { PackageSearch } from "lucide-react";
import { OperationalShell } from "@/components/operational/operational-shell";

export function SeparadorShell({ children, userName }: { children: React.ReactNode; userName: string }) {
  return (
    <OperationalShell area="Separação" areaIcon={<PackageSearch className="size-4" />} userName={userName}>
      {children}
    </OperationalShell>
  );
}
