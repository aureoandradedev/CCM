import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recebimento", robots: { index: false, follow: false } };

export default async function RecebedorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["recebedor"], "/recebedor");
  return <>{children}</>;
}
