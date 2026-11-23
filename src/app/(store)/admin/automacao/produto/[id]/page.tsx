import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { getProductHistory } from "@/lib/admin/automacao-data";

import { Timeline } from "../../timeline-client";

export default async function ProductHistoryPage(props: {
  params: Promise<{ id: string }>;
}) {
  if (!configured()) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">
        Banco de dados não configurado.
      </div>
    );
  }

  const { id } = await props.params;
  const history = await getProductHistory(id);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/automacao"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-navy hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Voltar para Central Operacional
        </Link>
      </div>

      <PageTitle
        title={`Histórico: ${history.productName}`}
        subtitle={`Todos os eventos de automação deste produto · ${history.events.length} evento(s)`}
      >
        <Link
          href={`/admin/produtos?q=${encodeURIComponent(history.productName)}`}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand-line bg-card px-3 text-xs font-semibold text-brand-ink transition-colors hover:border-brand-navy/40"
        >
          Abrir produto
        </Link>
      </PageTitle>

      <Timeline
        events={history.events}
        total={history.events.length}
        page={1}
        perPage={200}
        baseParams={{}}
      />
    </>
  );
}
