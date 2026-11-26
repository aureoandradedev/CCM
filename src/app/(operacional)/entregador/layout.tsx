import type { Metadata } from "next";

import { requireRole } from "@/lib/admin/guard";
import { firstName } from "@/lib/supabase/auth";
import { EntregadorShell } from "@/components/entregador/entregador-shell";
import { EntregadorRoleProvider } from "./role-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Entregas", robots: { index: false, follow: false } };

export default async function EntregadorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["entregador"], "/entregador");
  return (
    <EntregadorShell userName={firstName(user)}>
      <EntregadorRoleProvider isAdmin={user.role === "admin"}>
        {children}
      </EntregadorRoleProvider>
    </EntregadorShell>
  );
}
