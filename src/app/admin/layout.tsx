import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { adminOrderCounts } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/guard";

// sessão vem de cookies: nunca pré-renderizar
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin CCM" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const counts = await adminOrderCounts();
  const pendentes = (counts["em-separacao"] ?? 0) + (counts["pagamento-pendente"] ?? 0);
  return (
    <AdminShell adminName={admin.fullName || admin.email} pendentes={pendentes}>
      {children}
    </AdminShell>
  );
}
