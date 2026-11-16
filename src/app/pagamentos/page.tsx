import type { Metadata } from "next";

import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Formas de pagamento",
  description: `Formas de pagamento aceitas na ${site.name}: Pix, cartão de crédito e débito, boleto e faturado PJ.`,
};

export default function PaymentsPage() {
  return (
    <InfoPage
      crumb="Formas de pagamento"
      title="Formas de pagamento"
      intro="Pagamento seguro processado pela Cielo. Você só é cobrado quando o pagamento é aprovado e a disponibilidade é confirmada."
    >
      <InfoSection title="Pix">
        <p>
          Pagamento instantâneo com <strong>5% de desconto</strong>. Após gerar o código Pix no checkout, você tem 30 minutos para efetuar o pagamento. A aprovação é automática.
        </p>
      </InfoSection>

      <InfoSection title="Cartão de crédito">
        <p>
          Aceitamos as bandeiras <strong>Visa</strong>, <strong>Mastercard</strong> e <strong>Elo</strong>. Os dados do cartão são tokenizados diretamente no navegador pela Cielo (SOP + 3DS) e nunca passam pelos nossos servidores.
        </p>
      </InfoSection>

      <InfoSection title="Cartão de débito">
        <p>
          Débito à vista nas mesmas bandeiras aceitas no crédito. O valor é debitado imediatamente após a aprovação.
        </p>
      </InfoSection>

      <InfoSection title="Boleto bancário">
        <p>
          Boleto com vencimento em 3 dias úteis. O pedido é processado após a compensação do boleto, que pode levar até 2 dias úteis.
        </p>
      </InfoSection>

      <InfoSection title="Faturado (PJ)">
        <p>
          Disponível para empresas com cadastro aprovado. Para solicitar a modalidade faturada, entre em contato pelo WhatsApp <a href={`https://wa.me/${site.whatsapp}`} className="text-brand-navy underline dark:text-brand-yellow">{site.phone}</a>.
        </p>
      </InfoSection>

      <InfoSection title="Segurança">
        <ul className="list-inside list-disc space-y-1">
          <li>Pagamentos processados pela Cielo/Braspag, líder em pagamentos no Brasil.</li>
          <li>Dados do cartão tokenizados no navegador (nunca trafegam pelos nossos servidores).</li>
          <li>Comunicação criptografada via HTTPS.</li>
          <li>Autenticação 3D Secure para transações com cartão.</li>
        </ul>
      </InfoSection>

      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Posso parcelar?", a: "Sim, no cartão de crédito. As condições de parcelamento são exibidas no checkout conforme o valor do pedido." },
            { q: "O desconto do Pix é aplicado automaticamente?", a: "Sim. Ao selecionar Pix como forma de pagamento no checkout, o desconto de 5% já aparece no total." },
            { q: "Meus dados do cartão ficam salvos?", a: "Não. Os dados são tokenizados pela Cielo no momento do pagamento e não são armazenados pela Multigiro Central de Compras." },
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
