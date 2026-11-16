"use client";

import { BellRing, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { maskPhone, onlyDigits } from "@/lib/utils/masks";

/** Captura de WhatsApp para ofertas (substitui o pop-up invasivo de cupom da Telhanorte). */
export function Newsletter() {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (onlyDigits(phone).length < 10) {
      toast.error("Digite um WhatsApp válido com DDD.");
      return;
    }
    setSending(true);
    // TODO: gravar em `leads` no Supabase quando o banco estiver ligado.
    await new Promise((r) => setTimeout(r, 500));
    setSending(false);
    setPhone("");
    toast.success("Pronto! Você vai receber as melhores ofertas no WhatsApp.");
  };

  return (
    <section className="container-ccm" aria-labelledby="news-title">
      <div className="grid items-center gap-6 rounded-3xl bg-brand-yellow px-6 py-8 text-brand-navy md:grid-cols-[1.2fr_1fr] md:px-10">
        <div className="flex items-start gap-4">
          <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-brand-yellow sm:inline-flex">
            <BellRing className="size-6" />
          </span>
          <div>
            <h2 id="news-title" className="font-heading text-2xl font-extrabold tracking-tight md:text-[1.75rem]">
              Ofertas exclusivas direto no seu WhatsApp
            </h2>
            <p className="mt-1 text-sm text-brand-navy/80">Uma mensagem por semana com ofertas exclusivas e novidades. Sem spam.</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="news-phone">
            WhatsApp com DDD
          </label>
          <input
            id="news-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            placeholder="(28) 99999-9999"
            className="h-12 flex-1 rounded-xl border-2 border-brand-navy/15 bg-white px-4 text-base text-brand-navy outline-none placeholder:text-brand-navy/40 focus-visible:border-brand-navy"
          />
          <Button type="submit" variant="navy" size="xl" disabled={sending}>
            <Send />
            {sending ? "Enviando..." : "Quero receber"}
          </Button>
        </form>
      </div>
    </section>
  );
}
