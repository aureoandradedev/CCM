import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { site, whatsappLink } from "@/lib/site";
import { getSupplierSession } from "@/lib/supplier/guard";

export const metadata: Metadata = {
  title: "Seja um fornecedor",
  description: "Forneça seus produtos para a Multigiro Central de Compras. Entre em contato com nossa equipe comercial.",
};

export default async function SuppliersPage() {
  const session = await getSupplierSession();
  if (session) redirect("/fornecedores/painel");
  return (
    <InfoPage
      crumb="Seja um fornecedor"
      eyebrow="Para distribuidores e fábricas"
      title="Forneça seus produtos para o CCM."
      intro="A Multigiro Central de Compras trabalha com fornecedores parceiros de material de construção. Nossa equipe de compras cuida de toda a operação: análise de catálogo, negociação de condições e seleção de produtos."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Sem gestão de plataforma", "Você não precisa administrar uma loja ou sistema. Nossa equipe importa e organiza seu catálogo internamente."],
          ["Condições negociadas", "Pedido mínimo, frete e prazos são definidos em parceria com a equipe comercial do CCM."],
          ["Foco no fornecimento", "Sua empresa foca em faturar e entregar. O CCM cuida da vitrine, precificação e atendimento ao cliente final."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-brand-line bg-card p-6">
            <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">{t}</p>
            <p className="mt-1 text-sm text-brand-ink-soft">{d}</p>
          </div>
        ))}
      </div>

      <InfoSection title="Quero ser parceiro">
        <p>
          Envie o nome da empresa, cidade e principais linhas de produtos.
          Nossa equipe comercial entra em contato para entender seu catálogo e condições de fornecimento.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="whatsapp" size="lg" render={<a href={whatsappLink("Olá! Quero ser fornecedor parceiro da Multigiro Central de Compras.")} target="_blank" rel="noreferrer" />}>
            Falar pelo WhatsApp
          </Button>
          <Button variant="outline-navy" size="lg" render={<a href={`mailto:${site.email}?subject=Quero ser fornecedor da Multigiro Central de Compras`} />}>
            Enviar e-mail
          </Button>
        </div>
      </InfoSection>
    </InfoPage>
  );
}
