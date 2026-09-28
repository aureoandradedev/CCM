import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { site, whatsappLink } from "@/lib/site";

export const metadata: Metadata = {
  title: "Seja um fornecedor",
  description: "Venda para as obras da região pela Multigiro Central de Compras sem custo fixo: você cadastra o catálogo, recebe os pedidos e entrega.",
};

export default function SuppliersPage() {
  return (
    <InfoPage
      crumb="Seja um fornecedor"
      eyebrow="Para distribuidores e fábricas"
      title="Venda para centenas de obras sem montar loja."
      intro="A Multigiro Central de Compras leva o seu catálogo para quem está construindo no Sul do Espírito Santo. Você define preço de varejo e de atacado, recebe o pedido pronto e cuida só da entrega."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Sem mensalidade", "Comissão só sobre pedido entregue e confirmado."],
          ["Catálogo integrado", "Planilha, API ou ERP: a integração chega na próxima fase e o seu estoque atualiza sozinho."],
          ["Pagamento garantido", "A Multigiro Central de Compras recebe do cliente e repassa em D+2 após a entrega confirmada."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-brand-line bg-card p-6">
            <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">{t}</p>
            <p className="mt-1 text-sm text-brand-ink-soft">{d}</p>
          </div>
        ))}
      </div>
      <InfoSection title="Quero ser parceiro">
        <p>Mande o nome da empresa, cidade e as linhas de produto que você atende. A equipe comercial responde em até 1 dia útil.</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="whatsapp" size="lg" render={<a href={whatsappLink("Olá! Quero ser fornecedor parceiro da Multigiro Central de Compras.")} target="_blank" rel="noreferrer" />}>
            Falar pelo WhatsApp
          </Button>
          <Button variant="outline-navy" size="lg" render={<a href={`mailto:${site.email}?subject=Quero ser fornecedor da Multigiro Central de Compras`} />}>
            Enviar e-mail
          </Button>
        </div>
      </InfoSection>
    </InfoPage>
  );
}
