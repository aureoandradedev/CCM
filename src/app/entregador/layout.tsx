import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Entregas", robots: { index: false, follow: false } };

export default async function EntregadorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["entregador"], "/entregador");
  return <>{children}</>;
}
