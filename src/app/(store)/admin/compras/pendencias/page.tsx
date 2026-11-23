import Link from "next/link";

import { PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { pendenciasDataAll } from "@/lib/admin/compras-data";
import { PendenciasClient } from "./_pendencias-client";

export default async function PendenciasPage() {
  if (!configured()) return <div className="p-6 text-sm text-brand-fg/60">Supabase não configurado.</div>;

  const data = await pendenciasDataAll();

  return (
    <>
      <PageTitle title="Pendências" subtitle={`${data.items.length} ${data.items.length === 1 ? "item aguardando" : "itens aguardando"} sua decisão`} />

      <PendenciasClient
        items={data.items}
        matchCount={data.matchCount}
        exceptionCount={data.exceptionCount}
        suppliers={data.suppliers}
        catalogs={data.catalogs}
      />

      <div className="mt-4 text-xs">
        <Link href="/admin/compras" className="text-brand-navy hover:underline">
          ← Voltar para Compras
        </Link>
      </div>
    </>
  );
}
