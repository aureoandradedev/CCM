import { notFound } from "next/navigation";

import { CampaignActions } from "@/components/admin/campaign-actions";
import { CampaignForm } from "@/components/admin/campaign-form";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminGetCampaign, adminProductIndex, configured } from "@/lib/admin/data";
import { formatDateTime } from "@/lib/orders";

export default async function EditCampaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!configured()) return <NotConfigured />;
  const [campaign, index] = await Promise.all([adminGetCampaign(id), adminProductIndex()]);
  if (!campaign) notFound();
  return (
    <>
      <PageTitle title={campaign.title} subtitle={`${campaign.status} · início ${formatDateTime(campaign.starts_at)}${campaign.activated_at ? ` · ativada ${formatDateTime(campaign.activated_at)}` : ""}`}>
        <CampaignActions campaign={campaign} />
      </PageTitle>
      <CampaignForm campaign={campaign} index={index} />
    </>
  );
}
