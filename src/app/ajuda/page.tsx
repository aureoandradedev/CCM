import type { Metadata } from "next";
import Link from "next/link";

import { Faq, InfoPage, InfoSection } from "@/components/layout/info-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Central de ajuda",
  description: `Encontre respostas para as dúvidas mais comuns sobre a ${site.name}.`,
};

const HELP_LINKS = [
  { href: "/como-funciona", label: "Como funciona a Central de Compras" },
  { href: "/entregas", label: "Prazos e entregas" },
  { href: "/trocas-devolucoes", label: "Trocas e devoluções" },
  { href: "/pagamentos", label: "Formas de pagamento" },
  { href: "/conta/pedidos", label: "Acompanhar meu pedido" },
  { href: "/politica-privacidade", label: "Política de privacidade" },
  { href: "/termos-de-uso", label: "Termos de uso" },
];

export default function HelpPage() {
  return (
    <InfoPage
      crumb="Central de ajuda"
      title="Central de ajuda"
      intro="Encontre respostas para as dúvidas mais comuns ou entre em contato com a equipe da Multigiro Central de Compras."
    >
      <InfoSection title="Assuntos mais procurados">
        <ul className="space-y-2">
          {HELP_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-brand-navy underline dark:text-brand-yellow">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </InfoSection>

      <InfoSection title="Perguntas frequentes">
        <Faq
          items={[
            { q: "Preciso ter CNPJ para comprar?", a: "Não. Qualquer pessoa pode comprar na Multigiro Central de Compras. O CNPJ só é necessário para a modalidade faturado (PJ com cadastro aprovado)." },
            { q: "Como funciona o preço de atacado?", a: "Cada produto tem uma quantidade mínima para o preço de atacado. Ao atingir essa quantidade no carrinho, o preço é aplicado automaticamente." },
            { q: "Quem entrega meu pedido?", a: "O fornecedor parceiro responsável pelo produto. Se o pedido tiver itens de fornecedores diferentes, cada um faz sua entrega separadamente." },
            { q: "Posso retirar na loja?", a: "Sim, quando o fornecedor oferece essa opção. No checkout, selecione 'Retirar na loja' para não pagar frete." },
            { q: "Como acompanho meu pedido?", a: "Acesse 'Minha conta' > 'Meus pedidos' ou clique em 'Acompanhar pedido' no topo do site. Você também recebe atualizações pelo WhatsApp." },
            { q: "O pagamento é seguro?", a: "Sim. Os pagamentos são processados pela Cielo, líder em pagamentos no Brasil. Dados do cartão são tokenizados no navegador e nunca passam pelos nossos servidores." },
          ]}
        />
      </InfoSection>

      <InfoSection title="Fale conosco">
        <p>
          Se não encontrou a resposta que procura, entre em contato:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            WhatsApp:{" "}
            <a href={`https://wa.me/${site.whatsapp}`} className="text-brand-navy underline dark:text-brand-yellow">{site.phone}</a>
          </li>
          <li>
            E-mail:{" "}
            <a href={`mailto:${site.email}`} className="text-brand-navy underline dark:text-brand-yellow">{site.email}</a>
          </li>
        </ul>
        <p className="text-sm text-brand-ink-soft">Horário de atendimento: {site.hours}.</p>
      </InfoSection>
    </InfoPage>
  );
}
