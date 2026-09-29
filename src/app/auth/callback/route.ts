import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail do Supabase (confirmação de conta, redefinição
 * de senha): troca o `code` por sessão e segue para `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/conta";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/conta";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/conta?erro=link", url.origin));
}
