import type { Metadata } from "next";

import { HowItWorks } from "@/components/home/how-it-works";
import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";

export const metadata: Metadata = {
  title: "Como funciona",
  description: "A Multigiro Central de Compras é uma central de compras: você monta o pedido e os fornecedores parceiros entregam direto na obra, com preço de atacado.",
};

export default function HowPage() {
  return (
    <InfoPage
      crumb="Como funciona"
      eyebrow="Central de compras"
      title="Como a Multigiro Central de Compras consegue preço de atacado sem ter estoque."
      intro="Em vez de comprar, estocar e revender, a Multigiro Central de Compras conecta a sua obra direto aos distribuidores e fábricas da região. Menos etapa no meio significa menos custo no preço final."
    >
      <div className="-mx-4 md:mx-0">
        <HowItWorks />
      </div>
      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Preciso ter CNPJ para pagar preço de atacado?", a: "Não. O preço de atacado vale para qualquer cliente que atinja a quantidade mínima do produto. O CNPJ só é necessário para a modalidade faturado." },
            { q: "Quem entrega o pedido?", a: "O fornecedor parceiro responsável por cada item. Se o pedido tiver produtos de dois fornecedores, chegam duas remessas e você acompanha as duas pelo site." },
            { q: "Quando eu pago?", a: "Só depois que o fornecedor confirma preço e disponibilidade. Pix, cartão em até 10x, boleto ou faturado para PJ aprovada." },
            { q: "E se vier com defeito?", a: "Você tem 7 dias para trocar ou devolver. A Multigiro Central de Compras intermedeia com o fornecedor e o transporte fica por conta dele." },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
