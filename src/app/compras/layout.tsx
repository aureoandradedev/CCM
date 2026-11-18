import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Compras", robots: { index: false, follow: false } };

export default async function ComprasLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["compras"], "/compras");
  return <>{children}</>;
}
