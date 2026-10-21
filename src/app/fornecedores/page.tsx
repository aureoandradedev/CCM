import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoPage, InfoSection } from "@/components/layout/info-page";
import { INTEGRATION_METHODS } from "@/lib/integrations/connectors";
import { site, whatsappLink } from "@/lib/site";

export const metadata: Metadata = {
  title: "Seja um fornecedor",
  description: "Forneça seus produtos para o CCM: envie catálogo, custos, estoque e condições comerciais. Nossa equipe analisa e seleciona as melhores ofertas para a Central de Compras.",
};

export default function SuppliersPage() {
  return (
    <InfoPage
      crumb="Seja um fornecedor"
      eyebrow="Para distribuidores e fábricas"
      title="Forneça seus produtos para o CCM."
      intro="Conecte seu catálogo e envie preços, estoque e condições comerciais. Nossa equipe analisa as ofertas e seleciona os produtos com melhor oportunidade para a Central de Compras."
    >
      {/* CTA principal — entrada da Central de Integração */}
      <section className="overflow-hidden rounded-3xl bg-brand-navy p-6 text-white md:p-10">
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <Badge className="bg-brand-yellow text-brand-navy">Central de Integração</Badge>
            <h2 className="mt-3 font-heading text-2xl font-extrabold md:text-3xl">Conecte sua empresa ao CCM em poucos minutos.</h2>
            <p className="mt-2 text-sm text-white/80">
              Importe seu catálogo por planilha, API, ERP, feed ou cadastro manual. O CCM organiza e valida as informações para análise da equipe de compras.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Button variant="brand" size="xl" render={<Link href="/fornecedores/integrar" />} className="gap-1">
              Integrar minha empresa <ArrowRight className="size-4" />
            </Button>
            <Button variant="ghost" size="lg" render={<Link href="/fornecedores/integracoes" />} className="text-white hover:bg-white/10">
              Ver minhas integrações
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Sem loja para administrar", "Envie seu catálogo e mantenha custos, estoque e condições comerciais atualizados sem precisar gerenciar uma vitrine própria dentro do CCM."],
          ["Catálogo integrado", "Envie por planilha, API, ERP, feed ou cadastro manual. O CCM padroniza as informações para análise de compras."],
          ["Parceria comercial simples", "As condições comerciais são definidas diretamente com o CCM conforme o perfil de fornecimento e os produtos selecionados."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-brand-line bg-card p-6">
            <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">{t}</p>
            <p className="mt-1 text-sm text-brand-ink-soft">{d}</p>
          </div>
        ))}
      </div>

      <InfoSection title="Formas de conectar seu catálogo">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATION_METHODS.map((m) => (
            <Link
              key={m.id}
              href="/fornecedores/integrar"
              className="press group flex flex-col gap-2 rounded-2xl border border-brand-line bg-card p-4 transition-colors hover:border-brand-navy/40"
            >
              <div className="flex items-center justify-between">
                <span className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">{m.title}</span>
                {m.status === "coming_soon" ? (
                  <Badge variant="secondary" className="bg-brand-line/60 text-brand-ink-soft">Em breve</Badge>
                ) : (
                  <Badge className="bg-brand-green-soft text-brand-green">Disponível</Badge>
                )}
              </div>
              <p className="text-xs leading-snug text-brand-ink-soft">{m.tagline}</p>
            </Link>
          ))}
        </div>
      </InfoSection>

      <InfoSection title="Quero ser parceiro">
        <p>Envie o nome da empresa, cidade e principais linhas de produtos. Nossa equipe comercial entra em contato para entender seu catálogo e condições de fornecimento.</p>
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
