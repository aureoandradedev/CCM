import type { Metadata } from "next";

import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";
import { getSiteSettings } from "@/lib/data/catalog";
import { shippingFromSettings } from "@/lib/shipping";
import { site } from "@/lib/site";
import { formatBRL } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Prazos e entregas",
  description: `Como funcionam as entregas da ${site.name}: prazos, frete, retirada no CD e área de cobertura.`,
};

export default async function DeliveryPage() {
  const settings = await getSiteSettings();
  const { freeShippingLabel, standardShipping } = shippingFromSettings(settings.frete);
  return (
    <InfoPage
      crumb="Prazos e entregas"
      title="Prazos e entregas"
      intro="Cada pedido na Multigiro Central de Compras é preparado e entregue pela CCM. Abaixo você encontra as informações gerais sobre prazos e modalidades."
    >
      <InfoSection title="Como funciona a entrega">
        <p>
          Após a confirmação do pagamento, a CCM separa o pedido e agenda a entrega no endereço informado no checkout. Você acompanha tudo pelo site.
        </p>
      </InfoSection>

      <InfoSection title="Prazo de entrega">
        <p>
          O prazo médio é de <strong>2 a 4 dias úteis</strong> após a confirmação do pagamento, dependendo do produto e da disponibilidade. Produtos sob encomenda ou em grande volume podem ter prazo diferenciado, informado antes da confirmação do pedido.
        </p>
      </InfoSection>

      <InfoSection title="Área de cobertura">
        <p>
          Atendemos todo o {settings.deliveryArea.label}. A disponibilidade de entrega e o valor do frete podem variar de acordo com a localidade.
        </p>
      </InfoSection>

      <InfoSection title="Frete">
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Frete grátis</strong> para pedidos acima de {freeShippingLabel} (entrega padrão).</li>
          <li><strong>Frete fixo</strong> de {formatBRL(standardShipping)} para pedidos abaixo desse valor.</li>
          <li>O valor do frete é exibido no checkout antes da confirmação.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Retirada no CD da CCM">
        <p>
          Você pode optar por retirar o pedido no CD da CCM, sem custo de frete. Essa opção aparece no checkout.
        </p>
      </InfoSection>

      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Posso agendar a entrega?", a: "Sim, a equipe entra em contato pelo WhatsApp para combinar o melhor horário para a entrega." },
            { q: "E se o produto chegar danificado?", a: "Entre em contato conosco em até 7 dias. A Multigiro Central de Compras resolve diretamente a troca ou devolução." },
            { q: "Entregam em qualquer endereço?", a: `Entregamos em endereços residenciais, obras e empresas dentro da área de cobertura (${settings.deliveryArea.label}).` },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
