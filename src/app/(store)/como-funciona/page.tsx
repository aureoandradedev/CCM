import type { Metadata } from "next";

import { HowItWorks } from "@/components/home/how-it-works";
import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";

export const metadata: Metadata = {
  title: "Como funciona",
  description: "A Multigiro Central de Compras compra dos melhores distribuidores e entrega na sua obra com os melhores preços.",
};

export default function HowPage() {
  return (
    <InfoPage
      crumb="Como funciona"
      eyebrow="Central de compras"
      title="Como a Multigiro Central de Compras consegue os melhores preços."
      intro="A Multigiro Central de Compras compra direto dos distribuidores e fábricas da região e revende para você. Negociação em volume e operação enxuta significam menos custo no preço final."
    >
      <div className="-mx-4 md:mx-0">
        <HowItWorks />
      </div>
      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Preciso ter CNPJ para comprar?", a: "Não. Qualquer pessoa pode comprar na Multigiro Central de Compras. O CNPJ só é necessário para a modalidade faturado." },
            { q: "Quem entrega o pedido?", a: "A própria Multigiro Central de Compras. Você acompanha tudo pelo site." },
            { q: "Quando eu pago?", a: "No momento do pedido. Pix, cartão em até 10x, boleto ou faturado para PJ aprovada." },
            { q: "E se vier com defeito?", a: "Você tem 7 dias para trocar ou devolver. A Multigiro Central de Compras resolve diretamente." },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
