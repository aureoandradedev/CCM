import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Factory, Truck } from "lucide-react";

import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "Você monta a lista",
    text: "Busque, compare varejo e atacado e adicione tudo em um carrinho só, de cimento a lâmpada.",
  },
  {
    icon: Factory,
    title: "O fornecedor parceiro separa",
    text: "Cada item vai direto para o distribuidor ou fábrica mais perto. Sem estoque parado, sem intermediário.",
  },
  {
    icon: Truck,
    title: "Entrega na sua obra",
    text: "Você acompanha cada remessa pelo site e paga só quando o fornecedor confirma o pedido.",
  },
];

/** Bloco de confiança: explica o modelo "direto do fornecedor" da Multigiro Central de Compras. */
export function HowItWorks() {
  return (
    <Reveal as="section" className="container-ccm" aria-labelledby="how-title" stagger={0.1}>
      <div className="relative overflow-hidden rounded-3xl bg-brand-navy px-6 py-10 text-white md:px-12 md:py-14">
        <div aria-hidden="true" className="absolute -top-32 -left-24 size-[420px] rounded-full bg-brand-navy-2/50 blur-3xl" />
        <div className="relative grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div data-reveal className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-yellow">Como funciona</p>
            <h2 id="how-title" className="mt-2 font-heading text-[2.1rem] leading-[1.02] font-extrabold tracking-tight text-balance md:text-[2.7rem]">
              Central de compras, não depósito. Por isso o preço é de atacado.
            </h2>
            <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-white/80">
              A Multigiro Central de Compras conecta a sua obra aos fornecedores da região. Você compra em um lugar só e recebe direto de quem fabrica ou distribui.
            </p>
            <Button variant="brand" size="lg" className="mt-6" render={<Link href="/como-funciona" />}>
              Entenda o modelo
              <ArrowRight />
            </Button>
            </div>
            <Image
              src="/brand/mascote-capacete-alpha.png"
              alt="Mascote da Multigiro segurando a lista de materiais"
              width={686}
              height={961}
              className="hidden w-32 shrink-0 md:block lg:w-40"
            />
          </div>

          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} data-reveal className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-yellow text-brand-navy">
                    <s.icon className="size-5" strokeWidth={2.2} />
                  </span>
                  <span className="font-heading text-3xl font-extrabold text-white/25">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-heading text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/75">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <dl className="mt-10 grid grid-cols-2 gap-4 border-t border-white/10 pt-8 text-center sm:grid-cols-4">
          {[
            ["+30", "fornecedores parceiros"],
            ["2 a 4 dias", "prazo médio de entrega"],
            ["0", "estoque parado"],
            ["5%", "de desconto no Pix"],
          ].map(([n, l]) => (
            <div key={l} data-reveal>
              <dt className="font-heading text-3xl font-extrabold text-brand-yellow md:text-4xl">{n}</dt>
              <dd className="mt-1 text-xs text-white/70 md:text-sm">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  );
}
