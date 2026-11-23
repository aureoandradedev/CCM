import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { InfoPage, InfoSection } from "@/components/layout/info-page";

export const metadata: Metadata = {
  title: "Programa para profissionais",
  description: "Pedreiros, eletricistas, engenheiros e arquitetos têm condições especiais, orçamento por lista e atendimento dedicado na Multigiro Central de Compras.",
};

export default function ProsPage() {
  return (
    <InfoPage
      crumb="Profissionais"
      eyebrow="Pedreiros, eletricistas, engenheiros e arquitetos"
      title="Quem constrói todo dia merece preço de todo dia."
      intro="Cadastre-se como profissional e tenha condições especiais em itens selecionados, orçamento por lista com resposta rápida e um vendedor dedicado no WhatsApp."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Preço especial", "Em cimento, argamassa, cabos e tintas selecionadas."],
          ["Lista salva por obra", "Repita o pedido da última obra em um clique."],
          ["Vendedor dedicado", "Um contato fixo que conhece o seu histórico."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-3xl border border-brand-line bg-card p-6">
            <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">{t}</p>
            <p className="mt-1 text-sm text-brand-ink-soft">{d}</p>
          </div>
        ))}
      </div>
      <InfoSection title="Como participar">
        <p>Crie a sua conta, informe o CPF ou CNPJ e o CREA/CAU (se tiver). A aprovação sai em até 1 dia útil.</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="brand" size="lg" render={<Link href="/conta" />}>
            Criar conta profissional
          </Button>
          <Button variant="outline-navy" size="lg" render={<Link href="/orcamento" />}>
            Mandar uma lista agora
          </Button>
        </div>
      </InfoSection>
    </InfoPage>
  );
}
