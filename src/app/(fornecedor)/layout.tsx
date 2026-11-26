import type { Metadata } from "next";

import { assertSupplier } from "@/lib/supplier/guard";
import { SupplierShell } from "@/components/supplier/supplier-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Portal Fornecedor", template: "%s | Portal Fornecedor" },
  robots: { index: false, follow: false },
};

export default async function SupplierPortalLayout({ children }: { children: React.ReactNode }) {
  const session = await assertSupplier();
  return <SupplierShell supplierName={session.supplierName}>{children}</SupplierShell>;
}
