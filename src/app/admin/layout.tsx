import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { adminOrderCounts, configured } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

// sessão vem de cookies: nunca pré-renderizar
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin CCM" }, robots: { index: false, follow: false } };

async function getPendenciaCount(): Promise<number> {
  if (!configured()) return 0;
  try {
    const sb = await createClient();
    const [matchRes, exRes] = await Promise.all([
      sb.from("supplier_catalog_items")
        .select("*", { count: "exact", head: true })
        .in("match_status", ["match_sugerido", "revisao_manual", "normalizado"]),
      sb.from("procurement_exceptions")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
    ]);
    return (matchRes.count ?? 0) + (exRes.count ?? 0);
  } catch {
    return 0;
  }
}

async function getRegistrationCount(): Promise<number> {
  if (!configured()) return 0;
  try {
    const sb = await createClient();
    const { count, error } = await sb
      .from("supplier_registration_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const [counts, pendenciaCount, registrationCount] = await Promise.all([
    adminOrderCounts(),
    getPendenciaCount(),
    getRegistrationCount(),
  ]);
  const pendentes = (counts["em-separacao"] ?? 0) + (counts["pagamento-pendente"] ?? 0);
  return (
    <AdminShell adminName={admin.fullName || admin.email} pendentes={pendentes} pendenciaCount={pendenciaCount} registrationCount={registrationCount}>
      {children}
    </AdminShell>
  );
}
