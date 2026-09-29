import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Factory, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/supabase/auth";
import { whatsappLink } from "@/lib/site";

export const metadata: Metadata = { title: "Pedido recebido", robots: { index: false } };

const STEPS = [
  { icon: ClipboardCheck, title: "Pagamento confirmado", text: "Enviamos os itens para os fornecedores parceiros." },
  { icon: Factory, title: "Fornecedor separa", text: "Cada fornecedor prepara a sua parte do pedido." },
  { icon: Truck, title: "Entrega na obra", text: "Você acompanha cada remessa em Meus pedidos e pelo WhatsApp." },
];

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const user = await getCurrentUser();
  return (
    <div className="container-ccm pt-10 md:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="relative mx-auto w-fit">
          <Image src="/brand/mascote-bone-alpha.png" alt="" width={335} height={370} className="h-44 w-auto" priority />
          <span className="absolute -right-2 bottom-2 inline-flex size-12 items-center justify-center rounded-full bg-brand-green text-white shadow-md">
            <CheckCircle2 className="size-7" />
          </span>
        </div>
        <h1 className="mt-5 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:text-[2.6rem]">Pedido recebido!</h1>
        {code ? (
          <p className="mt-2 text-brand-ink-soft">
            Número do pedido: <strong className="font-heading text-lg text-brand-navy">{code}</strong>
          </p>
        ) : null}
        <p className="mt-2 text-sm text-brand-ink-soft">
          {user ? "Acompanhe o andamento em Meus pedidos." : "Guarde o número do pedido: com ele e o seu CPF/CNPJ você acompanha tudo em Acompanhar pedido."}
        </p>
      </div>

      <ol className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-brand-line bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-yellow text-brand-navy">
                <s.icon className="size-5" />
              </span>
              <span className="font-heading text-2xl font-extrabold text-brand-line">0{i + 1}</span>
            </div>
            <p className="mt-3 font-heading text-base font-bold text-brand-navy">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-brand-ink-soft">{s.text}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button variant="brand" size="lg" render={<Link href={user ? "/conta/pedidos" : "/conta/pedidos"} />}>
          {user ? "Ver meus pedidos" : "Acompanhar pedido"}
        </Button>
        <Button variant="outline-navy" size="lg" render={<Link href="/" />}>
          Voltar para a loja
        </Button>
        <Button variant="whatsapp" size="lg" render={<a href={whatsappLink(`Olá! Acabei de fazer o pedido ${code ?? ""} na Multigiro Central de Compras.`)} target="_blank" rel="noreferrer" />}>
          Falar com a televendas
        </Button>
      </div>
    </div>
  );
}
