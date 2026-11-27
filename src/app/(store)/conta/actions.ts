"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, releaseOrderCreditOnCancel } from "@/lib/supabase/admin";
import { ROLE_HOME, type UserRole } from "@/lib/supabase/auth";
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

  const explicitNext = formData.get("next");
  if (explicitNext && String(explicitNext) !== "/conta" && String(explicitNext).startsWith("/")) {
    redirect(safeNext(explicitNext));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, supplier_id")
    .eq("id", (await supabase.auth.getUser()).data.user!.id)
    .maybeSingle();

  if (profile?.supplier_id) redirect("/fornecedores/painel");

  const role = (profile?.role as UserRole) ?? "customer";
  redirect(ROLE_HOME[role] ?? "/conta");
}

/** Criar conta (PF ou PJ). O perfil é criado pelo trigger `handle_new_user`. */
export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const document = onlyDigits(formData.get("document"));
  const phone = onlyDigits(formData.get("phone"));

  if (fullName.length < 3) return { error: "Digite seu nome completo." };
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== confirmPassword) return { error: "As senhas não coincidem." };
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

/** Exporta os dados pessoais do usuário autenticado (LGPD art. 18). */
export async function exportMyData(): Promise<{ error?: string; data?: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, document, person_type, phone, email, created_at")
    .eq("id", user.id)
    .single();

  const { data: addresses } = await supabase
    .from("addresses")
    .select("label, cep, street, number, complement, district, city, state, reference, is_default, created_at")
    .eq("profile_id", user.id);

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "code, created_at, order_status, payment_status, payment_method, delivery_method, total_centavos, subtotal_centavos, discount_centavos, freight_centavos, items_count, notes, customer, address, paid_at, order_items(name, sku, unit, qty, price_tier, unit_price_centavos, line_centavos)",
    )
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  return {
    data: JSON.stringify(
      { exportado_em: new Date().toISOString(), perfil: profile, enderecos: addresses ?? [], pedidos: orders ?? [] },
      null,
      2,
    ),
  };
}

/** Anonimiza e exclui a conta do usuário autenticado (LGPD art. 18). */
export async function requestAccountDeletion(): Promise<ActionState | never> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const { error } = await supabase.rpc("anonymize_my_account");
  if (error) {
    console.error("anonymize_my_account error:", error.message);
    return { error: "Não foi possível processar a solicitação. Tente novamente ou entre em contato pelo e-mail." };
  }

  await supabase.auth.signOut();
  redirect("/");
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

export async function cancelMyOrder(orderId: string): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para cancelar." };

  const { data, error } = await supabase.rpc("customer_cancel_order", { p_order_id: orderId });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error as string };
  // G4: Cancel pending supplier_requests (service_role required)
  try { await createAdminClient().rpc("cancel_order_requests", { p_order_id: orderId }); } catch {}
  // CCM Etapa 5: release CCM stock reservations on cancel
  try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: orderId }); } catch {}
  await releaseOrderCreditOnCancel(orderId, "Pedido cancelado pelo cliente");
  return { ok: "Pedido cancelado com sucesso." };
}

export async function acceptOrderAdjustments(orderId: string): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const { data, error } = await supabase.rpc("accept_order_adjustments", { p_order_id: orderId });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string } | null;
  if (result && !result.ok) return { error: result.error ?? "Erro ao aceitar ajustes." };
  return { ok: "Ajustes aceitos. Pagamento liberado!" };
}

export async function acceptBackupDeliveryDate(orderId: string): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const { data, error } = await supabase.rpc("accept_backup_delivery_date", { p_order_id: orderId });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string } | null;
  if (result && !result.ok) return { error: result.error ?? "Erro ao aceitar prazo." };
  return { ok: "Prazo aceito. Pagamento liberado!" };
}

export async function removeMyOrderItem(orderId: string, orderItemId: string, reason: string): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Faça login para continuar." };

  const { data, error } = await supabase.rpc("remove_order_item_v2", {
    p_order_id: orderId,
    p_order_item_id: orderItemId,
    p_reason: reason || "Removido pelo cliente",
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string } | null;
  if (result && !result.ok) return { error: result.error ?? "Erro ao remover item." };
  return { ok: "Item removido do pedido." };
}
