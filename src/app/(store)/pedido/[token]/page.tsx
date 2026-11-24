import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, CreditCard, Package } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Acompanhar pedido", robots: { index: false } };

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api").replace(/\/$/, "");

interface TokenValidation {
  ok: boolean;
  order_id: string;
  scope: string;
  error?: string;
}

async function validateToken(token: string): Promise<TokenValidation | null> {
  try {
    const res = await fetch(`${API_BASE}/outbox/validate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json() as TokenValidation;
    return data.ok ? data : null;
  } catch {
    return null;
  }
}

export default async function GuestOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length !== 64) notFound();

  const validation = await validateToken(token);
  if (!validation) {
    return (
      <div className="container-ccm pt-10 md:pt-16">
        <div className="mx-auto max-w-lg text-center">
          <Clock className="mx-auto size-12 text-brand-orange" />
          <h1 className="mt-4 font-heading text-2xl font-extrabold text-brand-navy">Link expirado ou inválido</h1>
          <p className="mt-2 text-sm text-brand-ink-soft">
            Este link pode ter expirado (validade de 7 dias) ou já foi utilizado.
            Para acompanhar seu pedido, faça login na sua conta.
          </p>
          <Button variant="brand" size="lg" className="mt-6" render={<Link href="/conta" />}>
            Entrar na minha conta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-ccm pt-10 md:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <CheckCircle2 className="mx-auto size-12 text-brand-green" />
        <h1 className="mt-4 font-heading text-2xl font-extrabold text-brand-navy">Acompanhar pedido</h1>
        <p className="mt-2 text-sm text-brand-ink-soft">
          Seu pedido está sendo processado. Você receberá uma notificação quando o pagamento for liberado.
        </p>

        <div className="mx-auto mt-8 max-w-md">
          <ol className="space-y-4 text-left">
            <TimelineStep icon={CheckCircle2} title="Pedido registrado" done />
            <TimelineStep icon={Package} title="Confirmando disponibilidade" active />
            <TimelineStep icon={CreditCard} title="Pagamento liberado" />
          </ol>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button variant="brand" size="lg" render={<Link href="/conta" />}>
            Entrar na minha conta
          </Button>
          <Button variant="outline-navy" size="lg" render={<Link href="/" />}>
            Voltar para a loja
          </Button>
        </div>
      </div>
    </div>
  );
}

function TimelineStep({ icon: Icon, title, done, active }: { icon: typeof CheckCircle2; title: string; done?: boolean; active?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`inline-flex size-9 items-center justify-center rounded-full ${done ? "bg-brand-green text-white" : active ? "bg-brand-yellow text-brand-navy" : "bg-muted text-brand-ink-soft"}`}>
        <Icon className="size-4.5" />
      </span>
      <span className={`text-sm font-medium ${done ? "text-brand-green" : active ? "text-brand-navy" : "text-brand-ink-soft"}`}>{title}</span>
    </li>
  );
}
