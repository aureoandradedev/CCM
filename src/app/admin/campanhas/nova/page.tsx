import { CampaignForm } from "@/components/admin/campaign-form";
import { NotConfigured, PageTitle } from "@/components/admin/ui";
import { adminProductIndex, configured } from "@/lib/admin/data";

export default async function NewCampaign() {
  if (!configured()) return <NotConfigured />;
  const index = await adminProductIndex();
  return (
    <>
      <PageTitle title="Nova campanha" />
      <CampaignForm campaign={null} index={index} />
    </>
  );
}
