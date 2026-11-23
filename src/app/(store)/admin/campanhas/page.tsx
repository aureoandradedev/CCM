import Link from "next/link";
import { Plus } from "lucide-react";

import { CampaignActions } from "@/components/admin/campaign-actions";
import { Empty, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { adminCampaigns, campanhaAtrasada, configured } from "@/lib/admin/data";
import { TONE_CLASS, formatDateTime } from "@/lib/orders";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = { agendada: "yellow", ativa: "green", encerrada: "slate", cancelada: "red", pulada: "slate" };

export default async function AdminCampaigns() {
  if (!configured()) return <NotConfigured />;
  const campanhas = await adminCampaigns();
  return (
    <>
      <PageTitle title="Campanhas" subtitle="Ofertas programadas com banners. Ative na hora marcada (ou antes) e encerre para restaurar os preços.">
        <Button variant="brand" render={<Link href="/admin/campanhas/nova" />}>
          <Plus /> Nova campanha
        </Button>
      </PageTitle>
      {campanhas.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Campanha</Th>
              <Th>Início</Th>
              <Th>Status</Th>
              <Th>Produtos</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {campanhas.map((c) => {
              const atrasada = campanhaAtrasada(c);
              return (
                <tr key={c.id} className="hover:bg-muted/50">
                  <Td>
                    <Link href={`/admin/campanhas/${c.id}`} className="font-semibold text-brand-navy hover:underline">
                      {c.title}
                    </Link>
                  </Td>
                  <Td className="text-xs">
                    {formatDateTime(c.starts_at)}
                    {atrasada ? <p className="font-bold text-brand-orange">passou da hora</p> : null}
                  </Td>
                  <Td>
                    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold", TONE_CLASS[STATUS_TONE[c.status] ?? "slate"])}>{c.status}</span>
                  </Td>
                  <Td className="text-xs">
                    {c.products.length} produto(s) · {c.banners.length} banner(s)
                  </Td>
                  <Td>
                    <CampaignActions campaign={c} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <Empty>Nenhuma campanha. Crie a primeira.</Empty>
      )}
    </>
  );
}
