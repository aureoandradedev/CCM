/**
 * Variáveis do Supabase. Enquanto `.env.local` não estiver preenchido, o site
 * roda 100% com o catálogo mock (`src/lib/data/mock.ts`) para a construção
 * visual não depender do banco.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
