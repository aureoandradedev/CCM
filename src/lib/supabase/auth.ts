import { cache } from "react";

import { createClient } from "./server";
import { isSupabaseConfigured } from "./env";

export type UserRole = "customer" | "admin" | "compras" | "recebedor" | "operacao" | "entregador";

export const OPERATIONAL_ROLES: UserRole[] = ["compras", "recebedor", "operacao", "entregador"];

export const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  compras: "/compras",
  recebedor: "/recebedor",
  operacao: "/separador",
  entregador: "/entregador",
  customer: "/conta",
};

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  document: string | null;
  phone: string | null;
  personType: "pf" | "pj";
}

/**
 * Usuário logado + perfil (tabela `profiles`). `cache()` do React garante uma
 * única consulta por request, mesmo que header, página e layout chamem.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, document, phone, person_type, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name || (user.user_metadata?.full_name as string) || "",
    role: (profile?.role as UserRole) ?? "customer",
    isActive: profile?.is_active ?? true,
    document: profile?.document ?? null,
    phone: profile?.phone ?? null,
    personType: (profile?.person_type as "pf" | "pj") ?? "pf",
  };
});

export function firstName(user: CurrentUser | null): string {
  if (!user) return "visitante";
  const n = user.fullName.trim().split(/\s+/)[0];
  return n || user.email.split("@")[0];
}
