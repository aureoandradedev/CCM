import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";
import { firstName } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { ComprasShell } from "@/components/compras/compras-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compras",
  robots: { index: false, follow: false },
};

async function pendenciaCount(): Promise<number> {
  const sb = await createClient();
  const [{ count: matchCount }, { count: exceptionCount }] = await Promise.all([
    sb
      .from("supplier_catalog_items")
      .select("*", { count: "exact", head: true })
      .in("match_status", ["match_sugerido", "revisao_manual", "normalizado"]),
    sb
      .from("operational_exceptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
  ]);
  return (matchCount ?? 0) + (exceptionCount ?? 0);
}

export default async function ComprasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole(["compras"], "/compras");
  const count = await pendenciaCount();

  return (
    <ComprasShell userName={firstName(user)} pendenciaCount={count}>
      {children}
    </ComprasShell>
  );
}
