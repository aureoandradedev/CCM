import type { Metadata } from "next";

import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Trocas e devoluções",
  description: `Política de trocas e devoluções da ${site.name}.`,
};

export default function ReturnsPage() {
  return (
    <InfoPage
      crumb="Trocas e devoluções"
      title="Trocas e devoluções"
      intro="Se algo não saiu como esperado, a Multigiro Central de Compras resolve diretamente a situação."
    >
      <InfoSection title="Prazo para solicitação">
        <p>
          Você tem até <strong>7 dias corridos</strong> após o recebimento do produto para solicitar troca ou devolução, conforme o Código de Defesa do Consumidor.
        </p>
      </InfoSection>

      <InfoSection title="Quando posso solicitar">
        <ul className="list-inside list-disc space-y-1">
          <li>Produto com defeito de fabricação.</li>
          <li>Produto diferente do que foi pedido.</li>
          <li>Produto danificado durante o transporte.</li>
          <li>Quantidade recebida diferente da quantidade comprada.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Como funciona">
        <ol className="list-inside list-decimal space-y-1">
          <li>Entre em contato pelo WhatsApp <a href={`https://wa.me/${site.whatsapp}`} className="text-brand-navy underline dark:text-brand-yellow">{site.phone}</a> ou pelo e-mail <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a> informando o código do pedido e o motivo.</li>
          <li>A equipe da {site.shortName} analisa a solicitação.</li>
          <li>A CCM providencia a coleta do produto e o envio do substituto ou o estorno, conforme o caso.</li>
        </ol>
        <p>O custo do transporte de devolução fica por conta da CCM quando aplicável.</p>
      </InfoSection>

      <InfoSection title="Estorno">
        <p>
          Após a confirmação da devolução, o estorno é processado na mesma forma de pagamento utilizada na compra. O prazo depende da operadora ou banco, podendo levar até 10 dias úteis.
        </p>
      </InfoSection>

      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Posso devolver por arrependimento?", a: "Sim, dentro do prazo de 7 dias após o recebimento, mesmo sem defeito. O produto deve estar na embalagem original e sem sinais de uso." },
            { q: "Quem paga o frete da devolução?", a: "Se o motivo for defeito, produto errado ou dano no transporte, a CCM arca com o frete. Em caso de arrependimento, o custo pode ser do cliente." },
            { q: "Quanto tempo leva a troca?", a: "Após a coleta do produto, o prazo para envio do substituto é o mesmo da entrega padrão (2 a 4 dias úteis)." },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
