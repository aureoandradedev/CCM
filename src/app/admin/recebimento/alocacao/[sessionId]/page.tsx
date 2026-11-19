import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { configured, readReceivingSession, readReceivingItems } from "@/lib/admin/data";
import { AllocationReview } from "@/components/admin/allocation-review";

export default async function AllocationReviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!configured()) return <NotConfigured />;

  const [session, items] = await Promise.all([
    readReceivingSession(sessionId),
    readReceivingItems(sessionId),
  ]);

  if (!session) {
    return (
      <>
        <PageTitle title="Sessão não encontrada">
          <Link href="/admin/recebimento" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
            <ArrowLeft className="h-4 w-4" /> Recebimento
          </Link>
        </PageTitle>
      </>
    );
  }

  if (session.allocation_confirmed_at) {
    return (
      <>
        <PageTitle title="Alocação já confirmada" subtitle={`Confirmada em ${new Date(session.allocation_confirmed_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`}>
          <Link href="/admin/recebimento" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
            <ArrowLeft className="h-4 w-4" /> Recebimento
          </Link>
        </PageTitle>
      </>
    );
  }

  const supplierName = session.supplier_purchase_orders?.suppliers?.name ?? "—";

  return (
    <>
      <PageTitle
        title="Revisar alocação"
        subtitle={`${supplierName} · PO ${session.purchase_order_id.slice(0, 8)}... · Concluído em ${session.completed_at ? new Date(session.completed_at).toLocaleDateString("pt-BR") : "—"}`}
      >
        <Link href="/admin/recebimento" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> Recebimento
        </Link>
      </PageTitle>

      <Card>
        <AllocationReview sessionId={sessionId} receivingItems={items} />
      </Card>
    </>
  );
}
