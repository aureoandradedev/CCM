import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";
import { firstName } from "@/lib/supabase/auth";
import { SeparadorShell } from "@/components/separador/separador-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Separação", robots: { index: false, follow: false } };

export default async function SeparadorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["operacao"], "/separador");
  return <SeparadorShell userName={firstName(user)}>{children}</SeparadorShell>;
}
