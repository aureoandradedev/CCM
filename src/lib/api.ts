"use client";

import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Base do backend (Express em backend/). Ex.: http://localhost:4000/api */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, data: Record<string, unknown>) {
    super(String(data?.erro ?? `Erro ${status}`));
    this.status = status;
    this.data = data ?? {};
  }
}

/** Token da sessão do Supabase (para o backend saber quem é o cliente/admin). */
export async function accessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  opts: { method?: "GET" | "POST" | "PUT"; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, { erro: "Não foi possível falar com o servidor de pedidos. Tente de novo em instantes." });
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data);
  return data as T;
}
