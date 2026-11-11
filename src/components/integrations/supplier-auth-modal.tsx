"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { signInForImport, signUpForImport } from "@/app/fornecedores/actions";
import { requestPasswordReset, type ActionState } from "@/app/conta/actions";
import { maskDocument, maskPhone } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const initial: ActionState = {};

interface SupplierAuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: () => void;
}

export function SupplierAuthModal({ open, onOpenChange, onAuthenticated }: SupplierAuthModalProps) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(signInForImport, initial);
  const [signupState, signupAction, signupPending] = useActionState(signUpForImport, initial);
  const [resetState, resetAction, resetPending] = useActionState(requestPasswordReset, initial);

  const state = mode === "login" ? loginState : mode === "signup" ? signupState : resetState;
  const authFired = useRef(false);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const signupPasswordInvalid = password.length < 8 || confirmPassword.length === 0 || password !== confirmPassword;

  useEffect(() => {
    if (authFired.current) return;
    const isLoginOk = loginState.ok === "Autenticado!";
    const isSignupOk = signupState.ok === "Conta criada!";
    if (isLoginOk || isSignupOk) {
      authFired.current = true;
      onAuthenticated();
    }
  }, [loginState.ok, signupState.ok, onAuthenticated]);

  useEffect(() => {
    if (open) authFired.current = false;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-extrabold text-brand-navy dark:text-foreground">
            {mode === "reset" ? "Recuperar senha" : "Entre para importar"}
          </DialogTitle>
          <DialogDescription>
            {mode === "reset"
              ? "Enviamos um link para você redefinir a senha."
              : "Faça login ou crie uma conta para enviar seu catálogo."}
          </DialogDescription>
        </DialogHeader>

        {mode !== "reset" ? (
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "h-9 rounded-lg text-sm font-semibold transition-colors",
                  mode === m
                    ? "bg-card text-brand-navy shadow-sm dark:text-foreground"
                    : "text-brand-ink-soft hover:text-brand-ink",
                )}
              >
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>
        ) : null}

        {state.error ? (
          <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p role="status" className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">
            {state.ok}
          </p>
        ) : null}

        {mode === "login" ? (
          <form key="modal-login" action={loginAction} className="space-y-4">
            <label className="block text-xs font-semibold text-brand-ink">
              E-mail
              <input name="email" className={cn(input, "mt-1")} type="email" autoComplete="email" required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              Senha
              <input name="password" className={cn(input, "mt-1")} type="password" autoComplete="current-password" minLength={6} required />
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
          <form key="modal-signup" action={signupAction} className="space-y-4">
            <label className="block text-xs font-semibold text-brand-ink">
              Nome completo
              <input name="full_name" className={cn(input, "mt-1")} autoComplete="name" required />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              CPF ou CNPJ
              <input
                name="document"
                className={cn(input, "mt-1")}
                inputMode="numeric"
                value={doc}
                onChange={(e) => setDoc(maskDocument(e.target.value))}
                required
              />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              WhatsApp
              <input
                name="phone"
                className={cn(input, "mt-1")}
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                required
              />
            </label>
            <label className="block text-xs font-semibold text-brand-ink">
              E-mail
              <input name="email" className={cn(input, "mt-1")} type="email" autoComplete="email" required />
            </label>
            <div>
              <label className="block text-xs font-semibold text-brand-ink">
                Senha (mínimo 8 caracteres)
                <span className="relative mt-1 block">
                  <input
                    name="password"
                    className={cn(input, "pr-10", passwordTooShort && "border-brand-red focus-visible:border-brand-red focus-visible:ring-brand-red/30")}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-brand-ink-soft hover:text-brand-ink"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
              {passwordTooShort && (
                <p className="mt-1 text-xs text-brand-red">A senha deve ter no mínimo 8 caracteres.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-ink">
                Confirmar senha
                <span className="relative mt-1 block">
                  <input
                    className={cn(input, "pr-10", passwordMismatch && "border-brand-red focus-visible:border-brand-red focus-visible:ring-brand-red/30")}
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-brand-ink-soft hover:text-brand-ink"
                    aria-label={showConfirmPassword ? "Ocultar confirmação" : "Mostrar confirmação"}
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
              {passwordMismatch && (
                <p className="mt-1 text-xs text-brand-red">As senhas não coincidem.</p>
              )}
            </div>
            <Button type="submit" variant="brand" size="xl" className="w-full" disabled={signupPending || signupPasswordInvalid}>
              <UserPlus />
              {signupPending ? "Criando..." : "Criar minha conta"}
            </Button>
          </form>
        ) : (
          <form key="modal-reset" action={resetAction} className="space-y-4">
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
      </DialogContent>
    </Dialog>
  );
}
