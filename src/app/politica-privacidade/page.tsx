import type { Metadata } from "next";
import Link from "next/link";

import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como a ${site.name} coleta, usa e protege seus dados pessoais.`,
};

export default function PrivacyPage() {
  return (
    <InfoPage crumb="Política de Privacidade" title="Política de Privacidade">
      <p className="rounded-2xl border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3 text-sm text-brand-ink-soft">
        Este documento é uma versão inicial e deve passar por revisão jurídica antes da publicação definitiva.
      </p>

      <InfoSection title="1. Quem somos">
        <p>
          A <strong>{site.name}</strong> é uma plataforma de e-commerce que conecta clientes a fornecedores parceiros de material de construção. Não mantemos estoque próprio: cada pedido é atendido diretamente pelo fornecedor responsável.
        </p>
        <p>Endereço: {site.address}.</p>
        <p>Contato para questões de privacidade: <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a>.</p>
      </InfoSection>

      <InfoSection title="2. Dados pessoais que coletamos">
        <p>Coletamos apenas os dados necessários para operar a plataforma:</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Cadastro:</strong> nome completo, CPF ou CNPJ, telefone (WhatsApp), e-mail e senha.</li>
          <li><strong>Pedidos:</strong> nome, CPF/CNPJ, telefone, e-mail, endereço de entrega e observações.</li>
          <li><strong>Pagamento:</strong> forma escolhida (Pix ou cartão). Os dados do cartão são tokenizados diretamente pelo processador de pagamento (Cielo) no seu navegador e nunca trafegam pelos nossos servidores.</li>
          <li><strong>Orçamento via WhatsApp:</strong> nome, telefone, cidade e lista de materiais. Esses dados são enviados diretamente para o WhatsApp e não são armazenados por nós.</li>
        </ul>
        <p>Não coletamos dados sensíveis (raça, religião, saúde, orientação) nem dados de menores de idade.</p>
      </InfoSection>

      <InfoSection title="3. Finalidade do tratamento">
        <ul className="list-inside list-disc space-y-1">
          <li>Criar e manter sua conta na plataforma.</li>
          <li>Processar pedidos, pagamentos e entregas.</li>
          <li>Entrar em contato sobre atualizações do pedido.</li>
          <li>Garantir a segurança da plataforma (autenticação, prevenção de fraude).</li>
          <li>Cumprir obrigações legais e regulatórias.</li>
        </ul>
      </InfoSection>

      <InfoSection title="4. Compartilhamento de dados">
        <p>Seus dados são compartilhados apenas quando necessário para a operação:</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Fornecedores parceiros:</strong> recebem nome, telefone, endereço de entrega e itens do pedido para realizar a entrega.</li>
          <li><strong>Processador de pagamento (Cielo/Braspag):</strong> recebe os dados necessários para processar o pagamento.</li>
          <li><strong>Serviço de autenticação (Supabase):</strong> armazena e gerencia credenciais de acesso de forma segura.</li>
        </ul>
        <p>Não vendemos, alugamos ou compartilhamos seus dados com terceiros para fins de marketing.</p>
      </InfoSection>

      <InfoSection title="5. Segurança">
        <ul className="list-inside list-disc space-y-1">
          <li>Comunicação criptografada via HTTPS.</li>
          <li>Autenticação processada pelo provedor de identidade (Supabase Auth). A {site.name} não armazena senhas em texto puro — o hash e a verificação são gerenciados inteiramente pelo provedor.</li>
          <li>Dados do cartão tokenizados no navegador, sem trafegar pelos nossos servidores.</li>
          <li>Acesso restrito a dados pessoais por colaboradores autorizados.</li>
          <li>Cabeçalhos de segurança (CSP, HSTS, rate limiting) implementados na plataforma.</li>
        </ul>
      </InfoSection>

      <InfoSection title="6. Retenção de dados">
        <p>Mantemos seus dados pessoais enquanto sua conta estiver ativa ou pelo tempo necessário para cumprir obrigações legais (como registros fiscais de pedidos). Pedidos cancelados ou expirados são mantidos para fins de histórico e obrigações fiscais.</p>
      </InfoSection>

      <InfoSection title="7. Seus direitos (LGPD)">
        <p>Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode solicitar:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>Confirmação de que tratamos seus dados.</li>
          <li>Acesso aos seus dados pessoais.</li>
          <li>Correção de dados incompletos ou desatualizados.</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários.</li>
          <li>Portabilidade dos dados.</li>
          <li>Revogação do consentimento.</li>
        </ul>
        <p>
          Para exercer esses direitos, entre em contato pelo e-mail{" "}
          <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a>.
          Responderemos em até 15 dias úteis.
        </p>
        <p className="text-sm text-brand-ink-soft">
          Nota: os mecanismos automatizados de exclusão e exportação de conta estão em desenvolvimento. Até sua implementação, essas solicitações serão atendidas manualmente via e-mail. A necessidade de nomeação de encarregado de dados (DPO) será avaliada conforme a aplicabilidade da LGPD ao porte e natureza da operação, em conjunto com revisão jurídica.
        </p>
      </InfoSection>

      <InfoSection title="8. Cookies e armazenamento local">
        <p>
          Utilizamos apenas cookies estritamente necessários para autenticação e sessão. Não utilizamos cookies de marketing, analytics ou rastreamento. Para mais detalhes, consulte nossa{" "}
          <Link href="/politica-cookies" className="text-brand-navy underline dark:text-brand-yellow">Política de Cookies</Link>.
        </p>
      </InfoSection>

      <InfoSection title="9. Alterações nesta política">
        <p>Esta política pode ser atualizada periodicamente. Alterações significativas serão comunicadas na plataforma. A data da última atualização estará sempre indicada abaixo.</p>
        <p className="text-sm text-brand-ink-soft">Última atualização: outubro de 2026.</p>
      </InfoSection>
    </InfoPage>
  );
}
