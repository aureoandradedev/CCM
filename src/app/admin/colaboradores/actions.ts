"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/supabase/auth";

const VALID_OP_ROLES: UserRole[] = ["admin", "compras", "recebedor", "operacao", "entregador"];

export interface ColabState {
  error?: string;
  ok?: string;
}

export async function setCollaborator(
  _prev: ColabState,
  formData: FormData,
): Promise<ColabState> {
  await assertAdmin();
  const profileId = String(formData.get("profile_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() as UserRole;
  const isActive = formData.get("is_active") !== "false";

  if (!profileId) return { error: "Perfil não informado." };
  if (!VALID_OP_ROLES.includes(role)) return { error: `Role inválida: ${role}` };

  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_collaborator", {
    p_profile_id: profileId,
    p_role: role,
    p_is_active: isActive,
  });

  if (error) return { error: error.message };
  revalidatePath("/admin/colaboradores");
  return { ok: "Colaborador atualizado." };
}

const MIN_PASSWORD_LENGTH = 6;

export async function createCollaborator(
  _prev: ColabState,
  formData: FormData,
): Promise<ColabState> {
  await assertAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() as UserRole;
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!email) return { error: "E-mail é obrigatório." };
  if (!fullName) return { error: "Nome completo é obrigatório." };
  if (!VALID_OP_ROLES.includes(role)) return { error: `Função inválida: ${role}` };
  if (!password) return { error: "Senha é obrigatória." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.` };
  }
  if (password !== confirmPassword) {
    return { error: "Senha e confirmação não conferem." };
  }

  const admin = createAdminClient();

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return {
      error:
        "Já existe uma conta com este e-mail. Use a edição na tabela para alterar função ou status.",
    };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError) {
    if (createError.message?.includes("already been registered")) {
      return { error: "E-mail já registrado no Supabase Auth." };
    }
    return { error: createError.message };
  }

  if (!created?.user) {
    return { error: "Falha ao criar usuário. Tente novamente." };
  }

  const sb = await createClient();
  const { error: roleError } = await sb.rpc("admin_set_collaborator", {
    p_profile_id: created.user.id,
    p_role: role,
    p_is_active: true,
  });

  if (roleError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: `Erro ao definir função. Usuário não foi criado: ${roleError.message}` };
  }

  revalidatePath("/admin/colaboradores");
  return {
    ok: "Colaborador criado. Ele já pode acessar com o e-mail e a senha definida.",
  };
}

export async function listCollaborators() {
  await assertAdmin();
  const sb = await createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, role, is_active, phone, created_at")
    .in("role", ["admin", "compras", "recebedor", "operacao", "entregador"])
    .order("full_name");
  if (error) throw new Error(error.message);
  return data ?? [];
}
