import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, NotConfigured, PageTitle } from "@/components/admin/ui";
import { configured } from "@/lib/admin/data";
import { ReceivingWorkflow } from "@/components/admin/receiving-workflow";

export default async function ReceivingDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  if (!configured()) return <NotConfigured />;

  return (
    <>
      <PageTitle title="Conferência de recebimento" subtitle={`PO: ${poId.slice(0, 8)}...`}>
        <Link href="/admin/recebimento" className="flex items-center gap-1 text-sm text-brand-ink-soft hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> Recebimento
        </Link>
      </PageTitle>

      <Card>
        <ReceivingWorkflow poId={poId} />
      </Card>
    </>
  );
}
