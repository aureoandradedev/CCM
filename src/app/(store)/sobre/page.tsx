import type { Metadata } from "next";

import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { getSiteSettings } from "@/lib/data/catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sobre a Multigiro",
  description: `Conheça a ${site.name}: uma central de compras de material de construção que conecta a sua obra aos melhores distribuidores da região.`,
};

export default async function AboutPage() {
  const settings = await getSiteSettings();
  return (
    <InfoPage
      crumb="Sobre a Multigiro"
      eyebrow="Quem somos"
      title="Uma central de compras para a sua obra."
      intro="A Multigiro Central de Compras nasceu com um propósito simples: garantir o melhor preço para quem constrói, reforma ou cuida de manutenção predial, sem a complexidade de negociar direto com distribuidores."
    >
      <InfoSection title="O modelo">
        <p>
          A <strong>{site.name}</strong> compra direto dos distribuidores e fábricas da região e revende para você. Selecionamos os melhores fornecedores, negociamos em volume e repassamos a economia no preço final.
        </p>
        <p>
          Isso significa menos etapas entre a fábrica e a sua obra, e por isso o preço é mais baixo mesmo para quantidades menores.
        </p>
      </InfoSection>

      <InfoSection title="O que nos diferencia">
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Preço negociado:</strong> compramos direto dos distribuidores e fábricas, sem intermediários desnecessários.</li>
          <li><strong>Fornecedores selecionados:</strong> cada parceiro é avaliado por preço, prazo e confiabilidade.</li>
          <li><strong>Entrega pela CCM:</strong> entregamos direto no endereço que você indicar.</li>
          <li><strong>Pagamento seguro:</strong> Pix com 5% de desconto, cartão via Cielo ou faturado para PJ.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Onde estamos">
        <p>Atendemos todo o {settings.deliveryArea.label}, com base em {site.address}.</p>
        <p>Horário de atendimento: {site.hours}.</p>
        <p>
          Televendas e WhatsApp:{" "}
          <a href={`https://wa.me/${site.whatsapp}`} className="text-brand-navy underline dark:text-brand-yellow">{site.phone}</a>.
        </p>
        <p>
          E-mail:{" "}
          <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
