import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";

const OPERATIONAL_ROUTES: Record<string, string[]> = {
  "/admin": ["admin"],
  "/compras": ["compras", "admin"],
  "/recebedor": ["recebedor", "admin"],
  "/separador": ["operacao", "admin"],
  "/entregador": ["entregador", "admin"],
};

const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
  compras: "/compras",
  recebedor: "/recebedor",
  operacao: "/separador",
  entregador: "/entregador",
  customer: "/conta",
};

/**
 * Renova a sessão do Supabase a cada request (padrão @supabase/ssr).
 * Sem `.env.local` preenchido, passa direto.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Não remover: mantém o token renovado para Server Components.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Rotas que exigem login
  const protegida = pathname.startsWith("/admin")
    || pathname.startsWith("/compras")
    || pathname.startsWith("/recebedor")
    || pathname.startsWith("/separador")
    || pathname.startsWith("/entregador")
    || /^\/conta\/(pedidos\/|dados|senha|privacidade)/.test(pathname);

  if (!user && protegida) {
    const url = request.nextUrl.clone();
    url.pathname = "/conta";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Role-based route protection (checked via profile in layout, but proxy catches early)
  if (user) {
    for (const [prefix, allowedRoles] of Object.entries(OPERATIONAL_ROUTES)) {
      if (pathname.startsWith(prefix) && prefix !== "/admin") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        const role = profile?.role ?? "customer";
        const isActive = profile?.is_active ?? true;
        const allowed = allowedRoles.includes(role);

        if (!allowed) {
          const home = ROLE_HOME[role] ?? "/conta";
          const url = request.nextUrl.clone();
          url.pathname = home;
          url.search = "?erro=permissao";
          return NextResponse.redirect(url);
        }

        if (role !== "admin" && !isActive) {
          const url = request.nextUrl.clone();
          url.pathname = "/conta";
          url.search = "?erro=inativo";
          return NextResponse.redirect(url);
        }

        break;
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|api/search|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
