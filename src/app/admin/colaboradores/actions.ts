"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
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

export async function searchUserByEmail(email: string) {
  await assertAdmin();
  const sb = await createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .ilike("email", `%${email}%`)
    .limit(10);
  if (error) throw new Error(error.message);
  return data ?? [];
}
