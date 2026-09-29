import { redirect } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "@/lib/supabase/auth";

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
