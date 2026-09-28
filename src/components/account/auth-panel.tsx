"use client";

import Link from "next/link";
import { HardHat, LogIn, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { maskDocument, maskPhone } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Entrar / criar conta. A autenticação (Supabase Auth) é ligada na próxima fase. */
export function AuthPanel() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.info("Login e cadastro entram na próxima fase com o Supabase Auth.", {
      description: "Enquanto isso, acompanhe pedidos pelo CPF/CNPJ ou fale com a televendas.",
    });
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-3xl bg-brand-navy p-8 text-white">
        <HardHat className="size-8 text-brand-yellow" />
        <h2 className="mt-4 font-heading text-[1.9rem] leading-tight font-extrabold tracking-tight">Uma conta para a obra inteira.</h2>
        <ul className="mt-5 space-y-3 text-sm text-white/80">
          {["Histórico de pedidos por fornecedor", "Endereços de obra salvos", "Preço de atacado e faturamento para CNPJ", "Listas de materiais para repetir compras"].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-yellow" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-brand-line bg-card p-6 md:p-8">
        <div className="grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Entrar ou criar conta">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("h-9 rounded-lg text-sm font-semibold transition-colors", mode === m ? "bg-card text-brand-navy shadow-sm dark:text-foreground" : "text-brand-ink-soft hover:text-brand-ink")}
            >
              {m === "login" ? "Entrar" : "Criar conta"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "signup" ? (
            <>
              <label className="block text-xs font-semibold text-brand-ink">
                Nome completo
                <input className={cn(input, "mt-1")} autoComplete="name" required />
              </label>
              <label className="block text-xs font-semibold text-brand-ink">
                CPF ou CNPJ
                <input className={cn(input, "mt-1")} inputMode="numeric" value={doc} onChange={(e) => setDoc(maskDocument(e.target.value))} required />
              </label>
              <label className="block text-xs font-semibold text-brand-ink">
                WhatsApp
                <input className={cn(input, "mt-1")} inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} required />
              </label>
            </>
          ) : null}
          <label className="block text-xs font-semibold text-brand-ink">
            E-mail
            <input className={cn(input, "mt-1")} type="email" autoComplete="email" required />
          </label>
          <label className="block text-xs font-semibold text-brand-ink">
            Senha
            <input className={cn(input, "mt-1")} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
          </label>
          <Button type="submit" variant="brand" size="xl" className="w-full">
            {mode === "login" ? <LogIn /> : <UserPlus />}
            {mode === "login" ? "Entrar" : "Criar minha conta"}
          </Button>
          {mode === "login" ? (
            <p className="text-center text-xs text-brand-ink-soft">
              Esqueceu a senha? <button type="button" className="underline" onClick={submit}>Recuperar</button>
            </p>
          ) : (
            <p className="text-center text-xs text-brand-ink-soft">
              Ao criar a conta você aceita os{" "}
              <Link href="/termos-de-uso" className="underline">
                termos de uso
              </Link>
              .
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
