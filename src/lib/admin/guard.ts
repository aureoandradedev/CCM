import { redirect } from "next/navigation";

import { getCurrentUser, ROLE_HOME, type CurrentUser, type UserRole } from "@/lib/supabase/auth";

/** Páginas do admin: exige usuário logado com role = admin (redireciona quem não é). */
export async function requireAdmin(next = "/admin"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/conta?next=${encodeURIComponent(next)}`);
  if (user.role !== "admin") redirect("/conta?erro=admin");
  return user;
}

/** Ações do admin: mesma checagem, mas lança em vez de redirecionar. */
export async function assertAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Acesso restrito ao administrador.");
  return user;
}

/**
 * Páginas operacionais: exige sessão + uma das roles permitidas + is_active.
 * Admin sempre passa (superuser operacional).
 */
export async function requireRole(allowedRoles: UserRole[], next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/conta?next=${encodeURIComponent(next ?? "/")}`);

  const allowed = user.role === "admin" || allowedRoles.includes(user.role);
  if (!allowed) {
    const home = ROLE_HOME[user.role] ?? "/conta";
    redirect(`${home}?erro=permissao`);
  }

  if (user.role !== "admin" && !user.isActive) {
    redirect("/conta?erro=inativo");
  }

  return user;
}

/**
 * Server actions operacionais: mesma checagem, mas lança em vez de redirecionar.
 * Admin sempre passa.
 */
export async function assertRole(allowedRoles: UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sessão expirada.");

  const allowed = user.role === "admin" || allowedRoles.includes(user.role);
  if (!allowed) throw new Error("Acesso negado para esta função.");

  if (user.role !== "admin" && !user.isActive) {
    throw new Error("Sua conta está desativada. Contate o administrador.");
  }

  return user;
}
