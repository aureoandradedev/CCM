"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { WhatsappIcon } from "@/components/ui/social-icons";
import { whatsappLink } from "@/lib/site";
import { maskPhone, onlyDigits } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-background px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const TYPES = ["Construção nova", "Reforma", "Acabamento", "Elétrica/hidráulica", "Cobertura", "Outro"];

/** Formulário de orçamento: monta a mensagem e abre o WhatsApp da televendas. */
export function QuoteForm() {
  const [form, setForm] = useState({ nome: "", whatsapp: "", tipo: TYPES[0], cidade: "", lista: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: k === "whatsapp" ? maskPhone(e.target.value) : e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.nome.trim().length < 2 || onlyDigits(form.whatsapp).length < 10 || form.lista.trim().length < 5) {
      toast.error("Preencha nome, WhatsApp e a lista de materiais.");
      return;
    }
    const msg = [
      `*Orçamento Multigiro Central de Compras*`,
      `Nome: ${form.nome}`,
      `WhatsApp: ${form.whatsapp}`,
      `Tipo de obra: ${form.tipo}`,
      form.cidade ? `Cidade: ${form.cidade}` : null,
      ``,
      `Lista de materiais:`,
      form.lista.trim(),
    ]
      .filter((l) => l !== null)
      .join("\n");
    window.open(whatsappLink(msg), "_blank", "noopener");
    toast.success("Abrimos o WhatsApp com a sua lista. É só enviar!");
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-brand-line bg-card p-6 md:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-brand-ink">
          Seu nome
          <input className={cn(input, "mt-1")} value={form.nome} onChange={set("nome")} autoComplete="name" required />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          WhatsApp
          <input className={cn(input, "mt-1")} value={form.whatsapp} onChange={set("whatsapp")} inputMode="tel" autoComplete="tel" required />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          Tipo de obra
          <select className={cn(input, "mt-1 cursor-pointer")} value={form.tipo} onChange={set("tipo")}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          Cidade da obra
          <input className={cn(input, "mt-1")} value={form.cidade} onChange={set("cidade")} placeholder="Cachoeiro de Itapemirim" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-brand-ink">
        Lista de materiais
        <textarea
          className={cn(input, "mt-1 h-44 resize-y py-2.5")}
          value={form.lista}
          onChange={set("lista")}
          placeholder={"Ex.:\n40 sacos de cimento CP II\n2 m³ de areia média\n1.000 blocos 9x19x29\n60 m² de porcelanato 60x60"}
          required
        />
      </label>
      <Button type="submit" variant="whatsapp" size="xl" className="w-full">
        <WhatsappIcon className="size-5" />
        Enviar lista pelo WhatsApp
        <Send />
      </Button>
      <p className="text-center text-xs text-brand-ink-soft">Sem compromisso. Você recebe a cotação e decide se fecha.</p>
    </form>
  );
}
