"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isValidCNPJ, isValidCPF, isValidEmail, maskPhone, onlyDigits } from "@/lib/utils/masks";

export interface ActionState {
  error?: string;
  ok?: string;
}

const NOT_CONFIGURED = "Banco de dados ainda não configurado. Preencha as chaves do Supabase em .env.local.";

function safeNext(v: FormDataEntryValue | null): string {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/conta";
}

async function siteUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${proto}://${host}`;
}

/** Entrar com e-mail e senha. */
export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isValidEmail(email) || password.length < 6) return { error: "Confira e-mail e senha." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login/i.test(error.message)) return { error: "E-mail ou senha incorretos." };
    if (/not confirmed/i.test(error.message)) return { error: "Confirme seu e-mail antes de entrar. Veja a caixa de entrada." };
    return { error: error.message };
  }
  redirect(safeNext(formData.get("next")));
}

/** Criar conta (PF ou PJ). O perfil é criado pelo trigger `handle_new_user`. */
export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const document = onlyDigits(formData.get("document"));
  const phone = onlyDigits(formData.get("phone"));

  if (fullName.length < 3) return { error: "Digite seu nome completo." };
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (!isValidCPF(document) && !isValidCNPJ(document)) return { error: "CPF ou CNPJ inválido." };
  if (phone.length < 10) return { error: "WhatsApp com DDD." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=/conta`,
      data: {
        full_name: fullName,
        document,
        phone: maskPhone(phone),
        person_type: document.length === 14 ? "pj" : "pf",
      },
    },
  });
  if (error) {
    if (/already registered/i.test(error.message)) return { error: "Este e-mail já tem conta. Tente entrar." };
    return { error: error.message };
  }
  // sem sessão = confirmação de e-mail ligada no projeto
  if (!data.session) return { ok: "Conta criada! Enviamos um link de confirmação para o seu e-mail." };
  redirect("/conta");
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

/** Envia o e-mail de recuperação de senha. */
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/conta/redefinir-senha`,
  });
  if (error) return { error: error.message };
  return { ok: "Se o e-mail existir, você recebe o link de redefinição em instantes." };
}

/** Define a nova senha (usuário chegou pelo link do e-mail). */
export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== confirm) return { error: "As senhas não conferem." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/conta?senha=ok");
}

/** Atualiza nome, documento e telefone do perfil. */
export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const document = onlyDigits(formData.get("document"));
  const phone = onlyDigits(formData.get("phone"));
  if (fullName.length < 3) return { error: "Digite seu nome completo." };
  if (document && !isValidCPF(document) && !isValidCNPJ(document)) return { error: "CPF ou CNPJ inválido." };
  if (phone && phone.length < 10) return { error: "WhatsApp com DDD." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      document: document || null,
      phone: phone ? maskPhone(phone) : null,
      person_type: document.length === 14 ? "pj" : "pf",
    })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: "Dados salvos." };
}
