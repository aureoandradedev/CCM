import { createClient } from "@supabase/supabase-js";

import { config, supabaseConfigurado } from "./config.mjs";

let admin = null;

/** Cliente com SERVICE ROLE: ignora RLS. Só o backend usa (equivale ao Admin SDK do Firebase). */
export function db() {
  if (!supabaseConfigurado()) throw new Error("Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  if (!admin) {
    admin = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}

/** Lê o usuário a partir do `Authorization: Bearer <access_token>` do Supabase Auth. */
export async function usuarioDoBearer(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { data, error } = await db().auth.getUser(m[1]);
  if (error || !data?.user) return null;
  const { data: profile } = await db().from("profiles").select("id, role, full_name, email").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email, role: profile?.role ?? "customer", fullName: profile?.full_name ?? "" };
}

/** Middleware: exige usuário logado (qualquer papel). */
export async function exigirLogin(req, res, next) {
  try {
    const u = await usuarioDoBearer(req);
    if (!u) return res.status(401).json({ ok: false, erro: "Faça login para continuar." });
    req.usuario = u;
    next();
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
}

/** Middleware: exige admin (profiles.role = 'admin'). */
export async function exigirAdmin(req, res, next) {
  try {
    const u = await usuarioDoBearer(req);
    if (!u) return res.status(401).json({ ok: false, erro: "Token ausente ou inválido." });
    if (u.role !== "admin") return res.status(403).json({ ok: false, erro: "Acesso restrito ao admin." });
    req.usuario = u;
    next();
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
}

/** Registra um evento no histórico do pedido (auditoria). Nunca lança. */
export async function registrarEvento(orderId, type, data = {}, actor = { kind: "system", id: null }, shipmentId = null) {
  try {
    await db().from("order_events").insert({
      order_id: orderId, type, data,
      actor_kind: actor.kind || "system",
      actor_id: actor.id || null,
      shipment_id: shipmentId || null,
    });
  } catch (e) {
    console.warn("[evento] falha ao registrar", type, e.message);
  }
}
