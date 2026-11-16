import type { Metadata } from "next";
import Link from "next/link";

import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Termos e condições de uso da plataforma ${site.name}.`,
};

export default function TermsPage() {
  return (
    <InfoPage crumb="Termos de Uso" title="Termos de Uso">
      <p className="rounded-2xl border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3 text-sm text-brand-ink-soft">
        Este documento é uma versão inicial e deve passar por revisão jurídica antes da publicação definitiva.
      </p>

      <InfoSection title="1. Sobre a plataforma">
        <p>
          A <strong>{site.name}</strong> é uma plataforma de e-commerce de material de construção. A CCM compra dos fornecedores e revende ao cliente: a CCM é responsável pela venda, emissão da nota fiscal e entrega.
        </p>
        <p>Ao utilizar a plataforma, você concorda com estes Termos de Uso.</p>
      </InfoSection>

      <InfoSection title="2. Contas de cliente">
        <ul className="list-inside list-disc space-y-1">
          <li>O cadastro exige nome, CPF ou CNPJ, telefone, e-mail e senha.</li>
          <li>Você é responsável pela veracidade dos dados informados e pela segurança da sua senha.</li>
          <li>Cada CPF/CNPJ pode manter uma única conta.</li>
          <li>A plataforma pode suspender contas que violem estes termos, apresentem dados falsos ou sejam utilizadas para fins fraudulentos.</li>
        </ul>
      </InfoSection>

      <InfoSection title="3. Fornecedores e vendedores">
        <p>
          A {site.name} seleciona os produtos, define os preços de venda e é responsável pela qualidade, disponibilidade e entrega dos itens vendidos. A nota fiscal é emitida pela CCM.
        </p>
      </InfoSection>

      <InfoSection title="4. Pedidos">
        <ul className="list-inside list-disc space-y-1">
          <li>Ao confirmar um pedido, você declara que revisou os itens, quantidades, valores e endereço de entrega.</li>
          <li>O pedido é registrado e processado pela {site.name}.</li>
          <li>A confirmação do pedido não garante disponibilidade: em caso de indisponibilidade de estoque, o pedido pode ser cancelado com reembolso integral.</li>
        </ul>
      </InfoSection>

      <InfoSection title="5. Preços e disponibilidade">
        <ul className="list-inside list-disc space-y-1">
          <li>Os preços exibidos são negociados com os fornecedores parceiros e podem variar conforme condições comerciais.</li>
          <li>Preços podem variar sem aviso prévio. O valor válido é o exibido no momento da confirmação do pedido.</li>
          <li>Desconto no Pix, quando disponível, é aplicado automaticamente.</li>
          <li>Disponibilidade de estoque é informada em tempo real, mas pode sofrer variação entre a consulta e a confirmação do pedido.</li>
        </ul>
      </InfoSection>

      <InfoSection title="6. Pagamentos">
        <ul className="list-inside list-disc space-y-1">
          <li>Formas aceitas: Pix e cartão de crédito/débito.</li>
          <li>O processamento do pagamento é feito por operadora terceirizada (Cielo). Os dados do cartão são tokenizados no seu navegador e não são armazenados pela {site.name}.</li>
          <li>Pedidos com pagamento Pix pendente são cancelados automaticamente após 24 horas sem confirmação.</li>
        </ul>
      </InfoSection>

      <InfoSection title="7. Entregas">
        <ul className="list-inside list-disc space-y-1">
          <li>A entrega é realizada pela {site.name} no endereço informado.</li>
          <li>Prazos de entrega são estimativas e podem variar.</li>
          <li>A modalidade de retirada está disponível quando indicado.</li>
        </ul>
      </InfoSection>

      <InfoSection title="8. Cancelamentos e devoluções">
        <ul className="list-inside list-disc space-y-1">
          <li>Pedidos podem ser cancelados antes do envio, sem custo.</li>
          <li>Após o recebimento, aplica-se o direito de arrependimento de 7 dias corridos conforme o Código de Defesa do Consumidor (art. 49), para compras realizadas pela internet.</li>
          <li>Produtos com defeito podem ser trocados ou devolvidos conforme a legislação vigente. A {site.name} resolve diretamente com o cliente.</li>
          <li>Estornos de pagamentos confirmados são processados pela mesma forma de pagamento utilizada na compra.</li>
        </ul>
      </InfoSection>

      <InfoSection title="9. Responsabilidades">
        <ul className="list-inside list-disc space-y-1">
          <li>A {site.name} se esforça para manter a plataforma disponível e segura, mas não garante funcionamento ininterrupto.</li>
          <li>Não nos responsabilizamos por indisponibilidade decorrente de manutenção, falhas de terceiros ou força maior.</li>
          <li>O cliente é responsável por fornecer dados corretos e manter sua conta segura.</li>
        </ul>
      </InfoSection>

      <InfoSection title="10. Comportamento proibido">
        <p>É proibido utilizar a plataforma para:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Fornecer dados falsos ou de terceiros sem autorização.</li>
          <li>Tentar acessar contas ou dados de outros usuários.</li>
          <li>Realizar pedidos fraudulentos ou com intuito de prejudicar a operação.</li>
          <li>Utilizar meios automatizados (bots, scrapers) sem autorização.</li>
        </ul>
        <p>A violação pode resultar em suspensão ou encerramento da conta.</p>
      </InfoSection>

      <InfoSection title="11. Propriedade intelectual">
        <p>
          O nome, logotipo, mascote, layout e conteúdo original da plataforma são de propriedade da {site.name} ou licenciados para ela. As imagens dos produtos são de propriedade dos respectivos fornecedores ou fabricantes.
        </p>
      </InfoSection>

      <InfoSection title="12. Privacidade">
        <p>
          O tratamento dos seus dados pessoais está descrito na nossa{" "}
          <Link href="/politica-privacidade" className="text-brand-navy underline dark:text-brand-yellow">Política de Privacidade</Link>.
        </p>
      </InfoSection>

      <InfoSection title="13. Alterações">
        <p>Estes termos podem ser atualizados a qualquer momento. Alterações significativas serão comunicadas na plataforma. O uso continuado após a publicação de alterações constitui aceitação dos novos termos.</p>
        <p className="text-sm text-brand-ink-soft">Última atualização: outubro de 2026.</p>
      </InfoSection>

      <InfoSection title="14. Foro">
        <p>O foro competente para dirimir quaisquer questões decorrentes destes Termos de Uso será definido conforme a legislação vigente e revisão jurídica.</p>
      </InfoSection>
    </InfoPage>
  );
}
