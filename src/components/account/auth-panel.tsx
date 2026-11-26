"use client";

import Link from "next/link";
import { Eye, EyeOff, HardHat, LogIn, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";

import { requestPasswordReset, signIn, signUp, type ActionState } from "@/app/conta/actions";
import { Button } from "@/components/ui/button";
import { useShippingConfig } from "@/lib/shipping-context";
import { maskDocument, maskPhone } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const initial: ActionState = {};

/** Entrar / criar conta / recuperar senha, com Supabase Auth via server actions. */
export function AuthPanel({ next = "/conta" }: { next?: string }) {
  const { freeShippingLabel } = useShippingConfig();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(signIn, initial);
  const [signupState, signupAction, signupPending] = useActionState(signUp, initial);
  const [resetState, resetAction, resetPending] = useActionState(requestPasswordReset, initial);

  const state = mode === "login" ? loginState : mode === "signup" ? signupState : resetState;

  const passwordTooShort = password.length < 8;
  const confirmTooShort = confirmPassword.length < 8;
  const passwordsMismatch = password !== confirmPassword;
  const signupDisabled = signupPending || passwordTooShort || confirmTooShort || passwordsMismatch;

  return (
    <div className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-[1fr_1fr]">
      <div className="rounded-3xl bg-brand-navy p-8 text-white">
        <HardHat className="size-8 text-brand-yellow" />
        <h2 className="mt-4 font-heading text-[1.9rem] leading-tight font-extrabold tracking-tight">Uma conta para a obra inteira.</h2>
        <ul className="mt-5 space-y-3 text-sm text-white/80">
          {["Histórico de pedidos", "Endereços de obra salvos", `Frete grátis acima de ${freeShippingLabel}`, "Listas de materiais para repetir compras"].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-yellow" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-brand-line bg-card p-6 md:p-8">
        {mode !== "reset" ? (
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
        ) : (
          <div>
            <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">Recuperar senha</h3>
            <p className="text-sm text-brand-ink-soft">Enviamos um link para você definir uma nova senha.</p>
          </div>
        )}

        {state.error ? (
          <p role="alert" className="mt-4 rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="mt-4 rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">
            {state.ok}
          </p>
        ) : null}

        {mode === "login" ? (
          <form key="login" action={loginAction} className="mt-5 space-y-4">
            <input type="hidden" name="next" value={next} />
            <label className="block text-xs font-semibold text-brand-ink">
              E-mail
              <input name="email" className={cn(input, "mt-1")} type="email" autoComplete="email" required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Senha
              <span className="relative mt-1 block">
                <input name="password" className={cn(input, "pr-10")} type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={6} required />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-brand-ink-soft hover:text-brand-ink"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <Button type="submit" variant="brand" size="xl" className="w-full" disabled={loginPending}>
              <LogIn />
              {loginPending ? "Entrando..." : "Entrar"}
            </Button>
            <p className="text-center text-xs text-brand-ink-soft">
              Esqueceu a senha?{" "}
              <button type="button" className="underline" onClick={() => setMode("reset")}>
                Recuperar
              </button>
            </p>
          </form>
        ) : mode === "signup" ? (
          <form key="signup" action={signupAction} className="mt-5 space-y-4">
            <label className="block text-xs font-semibold text-brand-ink">
              Nome completo
              <input name="full_name" className={cn(input, "mt-1")} autoComplete="name" required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              CPF ou CNPJ
              <input name="document" className={cn(input, "mt-1")} inputMode="numeric" value={doc} onChange={(e) => setDoc(maskDocument(e.target.value))} required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              WhatsApp
              <input name="phone" className={cn(input, "mt-1")} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              E-mail
              <input name="email" className={cn(input, "mt-1")} type="email" autoComplete="email" required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Senha (mínimo 8 caracteres)
              <span className="relative mt-1 block">
                <input name="password" className={cn(input, "pr-10")} type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-brand-ink-soft hover:text-brand-ink"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Confirmar senha
              <span className="relative mt-1 block">
                <input name="confirmPassword" className={cn(input, "pr-10")} type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-brand-ink-soft hover:text-brand-ink"
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            {confirmPassword.length > 0 && passwordsMismatch ? (
              <p role="alert" className="text-sm text-brand-red">As senhas não coincidem</p>
            ) : null}
            <Button type="submit" variant="brand" size="xl" className="w-full" disabled={signupDisabled}>
              <UserPlus />
              {signupPending ? "Criando..." : "Criar minha conta"}
            </Button>
            <p className="text-center text-xs text-brand-ink-soft">
              Ao criar a conta você aceita os{" "}
              <Link href="/termos-de-uso" className="underline">
                termos de uso
              </Link>
              .
            </p>
          </form>
        ) : (
          <form key="reset" action={resetAction} className="mt-5 space-y-4">
            <label className="block text-xs font-semibold text-brand-ink">
              E-mail da conta
              <input name="email" className={cn(input, "mt-1")} type="email" autoComplete="email" required />
            </label>
            <Button type="submit" variant="brand" size="xl" className="w-full" disabled={resetPending}>
              {resetPending ? "Enviando..." : "Enviar link"}
            </Button>
            <p className="text-center text-xs text-brand-ink-soft">
              <button type="button" className="underline" onClick={() => setMode("login")}>
                Voltar para entrar
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
