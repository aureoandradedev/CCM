import type { Metadata } from "next";
import Image from "next/image";
import { ClipboardList, Clock, Percent } from "lucide-react";

import { QuoteForm } from "@/components/account/quote-form";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = {
  title: "Orçamento de obra",
  description: "Mande a lista de materiais da sua obra e receba a cotação dos fornecedores parceiros da Multigiro Central de Compras.",
};

export default function QuotePage() {
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Orçamento de obra" }]} />
      <div className="mt-4 grid gap-8 md:mt-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">Lista de materiais</p>
          <h1 className="mt-1 font-heading text-[2rem] leading-none font-extrabold tracking-tight text-brand-navy md:text-[2.6rem] dark:text-foreground">Mande a lista, a gente cota com os fornecedores.</h1>
          <p className="mt-3 text-sm leading-relaxed text-brand-ink-soft">
            Cole a lista do engenheiro ou escreva do seu jeito. Nossa equipe monta o pedido com o melhor preço e devolve pelo WhatsApp.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {[
              { icon: ClipboardList, text: "Aceita lista em texto, foto ou planilha" },
              { icon: Percent, text: "Preço negociado direto com o fornecedor" },
              { icon: Clock, text: "Resposta em até 1 dia útil" },
            ].map(({ icon: I, text }) => (
              <li key={text} className="flex items-center gap-3 text-brand-ink">
                <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-yellow-soft text-brand-navy">
                  <I className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <Image src="/brand/mascote-capacete-alpha.png" alt="Mascote da Multigiro com a prancheta de orçamento" width={686} height={961} className="mt-8 hidden h-64 w-auto lg:block" />
        </div>
        <QuoteForm />
      </div>
    </div>
  );
}
