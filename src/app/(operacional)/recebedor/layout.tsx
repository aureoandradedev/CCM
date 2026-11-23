import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";
import { firstName } from "@/lib/supabase/auth";
import { RecebedorShell } from "@/components/recebedor/recebedor-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recebimento", robots: { index: false, follow: false } };

export default async function RecebedorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["recebedor"], "/recebedor");
  return <RecebedorShell userName={firstName(user)}>{children}</RecebedorShell>;
}
