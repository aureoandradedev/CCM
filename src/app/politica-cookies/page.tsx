import type { Metadata } from "next";
import Link from "next/link";

import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Política de Cookies",
  description: `Como a ${site.name} utiliza cookies e armazenamento local.`,
};

export default function CookiesPage() {
  return (
    <InfoPage crumb="Política de Cookies" title="Política de Cookies">
      <p className="rounded-2xl border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3 text-sm text-brand-ink-soft">
        Este documento é uma versão inicial e deve passar por revisão jurídica antes da publicação definitiva.
      </p>

      <InfoSection title="1. O que são cookies">
        <p>Cookies são pequenos arquivos de texto armazenados no seu navegador quando você visita um site. Eles permitem que o site reconheça seu dispositivo e mantenha informações entre páginas e visitas.</p>
      </InfoSection>

      <InfoSection title="2. Cookies que utilizamos">
        <p>A {site.name} utiliza <strong>apenas cookies estritamente necessários</strong> para o funcionamento da plataforma:</p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-left">
                <th className="pb-2 pr-4 font-semibold">Cookie</th>
                <th className="pb-2 pr-4 font-semibold">Finalidade</th>
                <th className="pb-2 font-semibold">Duração</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line/50">
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">sb-*-auth-token</td>
                <td className="py-2 pr-4">Sessão de autenticação. Mantém você logado na plataforma.</td>
                <td className="py-2 text-nowrap">Até o logout</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-brand-ink-soft">Esses cookies são definidos pelo serviço de autenticação (Supabase) e são indispensáveis para login, acesso à conta e proteção contra acesso não autorizado.</p>
      </InfoSection>

      <InfoSection title="3. Armazenamento local">
        <p>Além dos cookies, utilizamos o armazenamento local do navegador para funcionalidades essenciais:</p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-left">
                <th className="pb-2 pr-4 font-semibold">Chave</th>
                <th className="pb-2 pr-4 font-semibold">Finalidade</th>
                <th className="pb-2 font-semibold">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line/50">
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">ccm_cart_v1</td>
                <td className="py-2 pr-4">Carrinho de compras. Preserva seus itens entre visitas.</td>
                <td className="py-2 text-nowrap">localStorage</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">ccm_intro_seen</td>
                <td className="py-2 pr-4">Controle da animação de abertura (exibida uma vez por sessão).</td>
                <td className="py-2 text-nowrap">sessionStorage</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">ccm_req</td>
                <td className="py-2 pr-4">Prevenção de pedidos duplicados durante o checkout.</td>
                <td className="py-2 text-nowrap">sessionStorage</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-brand-ink-soft">Esses dados ficam apenas no seu navegador e não são enviados a terceiros.</p>
      </InfoSection>

      <InfoSection title="4. Cookies de terceiros">
        <p>Durante o pagamento com cartão, os scripts do processador de pagamento (Cielo/Braspag) podem criar cookies próprios para segurança da transação (tokenização e autenticação 3D Secure). Esses cookies são gerenciados exclusivamente pela Cielo e estão sujeitos à política de privacidade dela.</p>
        <p>Fora do fluxo de pagamento, nenhum cookie de terceiro é carregado.</p>
      </InfoSection>

      <InfoSection title="5. Cookies de analytics e marketing">
        <p>A {site.name} <strong>não utiliza</strong> cookies de analytics, marketing, rastreamento ou publicidade. Não há Google Analytics, Meta Pixel, nem qualquer outra ferramenta de rastreamento instalada.</p>
      </InfoSection>

      <InfoSection title="6. Banner de consentimento">
        <p>Como utilizamos exclusivamente cookies necessários para o funcionamento da plataforma (autenticação e segurança), não exibimos banner de consentimento de cookies. Esses cookies não podem ser desativados sem comprometer o uso da plataforma.</p>
      </InfoSection>

      <InfoSection title="7. Como gerenciar cookies">
        <p>Você pode configurar seu navegador para bloquear ou excluir cookies a qualquer momento. No entanto, isso pode impedir o login e o funcionamento correto da plataforma.</p>
      </InfoSection>

      <InfoSection title="8. Mais informações">
        <p>
          Para dúvidas sobre o uso de cookies, entre em contato pelo e-mail{" "}
          <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a>
          . Consulte também nossa{" "}
          <Link href="/politica-privacidade" className="text-brand-navy underline dark:text-brand-yellow">Política de Privacidade</Link>.
        </p>
        <p className="text-sm text-brand-ink-soft">Última atualização: outubro de 2026.</p>
      </InfoSection>
    </InfoPage>
  );
}
