import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Separação", robots: { index: false, follow: false } };

export default async function SeparadorLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["operacao"], "/separador");
  return <>{children}</>;
}
