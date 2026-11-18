import type { Metadata } from "next";

import { requireAdmin } from "@/lib/admin/guard";

import { listCollaborators } from "./actions";
import { ColaboradoresPanel } from "./_panel";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function ColaboradoresPage() {
  await requireAdmin();
  const colaboradores = await listCollaborators();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-navy">Colaboradores</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os colaboradores operacionais: defina função, ative ou desative acessos.
        </p>
      </div>
      <ColaboradoresPanel initialData={colaboradores} />
    </div>
  );
}
