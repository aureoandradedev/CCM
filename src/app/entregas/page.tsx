import type { Metadata } from "next";

import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Prazos e entregas",
  description: `Como funcionam as entregas da ${site.name}: prazos, frete, retirada na loja e área de cobertura.`,
};

export default function DeliveryPage() {
  return (
    <InfoPage
      crumb="Prazos e entregas"
      title="Prazos e entregas"
      intro="Cada pedido na Multigiro Central de Compras é preparado e entregue diretamente pelo fornecedor parceiro responsável pelo produto. Abaixo você encontra as informações gerais sobre prazos e modalidades."
    >
      <InfoSection title="Como funciona a entrega">
        <p>
          Após a confirmação do pagamento, o fornecedor parceiro separa o pedido e agenda a entrega no endereço informado no checkout. Se o pedido incluir produtos de fornecedores diferentes, cada um faz sua entrega separadamente e você acompanha todas pelo site.
        </p>
      </InfoSection>

      <InfoSection title="Prazo de entrega">
        <p>
          O prazo médio é de <strong>2 a 4 dias úteis</strong> após a confirmação do pagamento, dependendo do produto e da disponibilidade do fornecedor. Produtos sob encomenda ou em grande volume podem ter prazo diferenciado, informado antes da confirmação do pedido.
        </p>
      </InfoSection>

      <InfoSection title="Área de cobertura">
        <p>
          Atendemos todo o sul do Espírito Santo. A disponibilidade de entrega e o valor do frete podem variar de acordo com a localidade e o fornecedor responsável pelo produto.
        </p>
      </InfoSection>

      <InfoSection title="Frete">
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Frete grátis</strong> para pedidos acima de R$ 799,00 (entrega padrão).</li>
          <li><strong>Frete fixo</strong> de R$ 49,90 para pedidos abaixo desse valor.</li>
          <li>O valor do frete é exibido no checkout antes da confirmação.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Retirada na loja">
        <p>
          Quando disponível, você pode optar por retirar o pedido diretamente com o fornecedor, sem custo de frete. Essa opção aparece no checkout quando o fornecedor oferece esse serviço.
        </p>
      </InfoSection>

      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Posso agendar a entrega?", a: "Sim, o fornecedor entra em contato pelo WhatsApp para combinar o melhor horário para a entrega." },
            { q: "E se o produto chegar danificado?", a: "Entre em contato conosco em até 7 dias. A Multigiro Central de Compras intermedeia a troca com o fornecedor e o transporte fica por conta dele." },
            { q: "Entregam em qualquer endereço?", a: "Entregamos em endereços residenciais, obras e empresas dentro da área de cobertura (sul do ES)." },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
