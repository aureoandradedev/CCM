"use server";

import { revalidatePath } from "next/cache";

import { assertAdmin } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";

export interface InviteActionResult {
  ok?: string;
  error?: string;
  inviteUrl?: string;
}

export interface RegistrationActionResult {
  ok?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Admin: generate invite link
// ---------------------------------------------------------------------------

export async function createSupplierInvite(): Promise<InviteActionResult> {
  try {
    const admin = await assertAdmin();
    const sb = await createClient();

    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await sb.from("supplier_invites").insert({
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: admin.id,
    });

    if (error) return { error: error.message };

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const inviteUrl = `${baseUrl}/fornecedores/cadastro/${token}`;

    revalidatePath("/admin/fornecedores", "layout");
    return { ok: "Convite gerado com validade de 7 dias.", inviteUrl };
  } catch (e) {
    return { error: (e as Error).message || "Erro ao gerar convite." };
  }
}

// ---------------------------------------------------------------------------
// Public: submit registration form (no auth required)
// ---------------------------------------------------------------------------

export async function submitSupplierRegistration(
  _prev: RegistrationActionResult,
  fd: FormData,
): Promise<RegistrationActionResult> {
  try {
    const sb = createPublicClient();
    if (!sb) return { error: "Serviço indisponível." };

    const token = String(fd.get("token") ?? "").trim();
    if (!token) return { error: "Token de convite ausente." };

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const diasPedidoRaw = fd.getAll("dias_pedido").map(Number).filter((n) => n >= 0 && n <= 6);
    const freteTipo = String(fd.get("frete_tipo") ?? "fixo").trim();

    const { data, error } = await sb.rpc("submit_supplier_registration", {
      p_token_hash: tokenHash,
      p_trade_name: String(fd.get("trade_name") ?? "").trim(),
      p_name: String(fd.get("name") ?? "").trim(),
      p_cnpj: String(fd.get("cnpj") ?? "").trim() || null,
      p_state: String(fd.get("state") ?? "").trim() || null,
      p_city: String(fd.get("city") ?? "").trim() || null,
      p_contact_name: String(fd.get("contact_name") ?? "").trim(),
      p_contact_email: String(fd.get("contact_email") ?? "").trim() || null,
      p_contact_phone: String(fd.get("contact_phone") ?? "").trim() || null,
      p_pedido_minimo_tipo: String(fd.get("pedido_minimo_tipo") ?? "valor").trim(),
      p_pedido_minimo: Number(String(fd.get("pedido_minimo") ?? "0").replace(/\./g, "").replace(",", ".")) || 0,
      p_dias_pedido: diasPedidoRaw.length > 0 ? diasPedidoRaw : [1, 2, 3, 4, 5],
      p_prazo_entrega_cd_dias: Number(fd.get("prazo_entrega_cd_dias")) || 3,
      p_frete_tipo: freteTipo,
      p_frete_gratis_acima: freteTipo === "gratis_acima" ? Number(String(fd.get("frete_gratis_acima") ?? "0").replace(/\./g, "").replace(",", ".")) || null : null,
      p_frete_valor: Number(String(fd.get("frete_valor") ?? "0").replace(/\./g, "").replace(",", ".")) || null,
    });

    if (error) return { error: error.message };
    const result = data as { ok: boolean; error?: string };
    if (!result.ok) return { error: result.error || "Erro ao enviar cadastro." };

    return { ok: "Cadastro enviado com sucesso! O administrador irá analisar sua solicitação." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

// ---------------------------------------------------------------------------
// Admin: approve registration (1-click)
// ---------------------------------------------------------------------------

export async function approveRegistration(requestId: string, supplierId?: string): Promise<RegistrationActionResult> {
  try {
    await assertAdmin();
    const sb = await createClient();

    const { data, error } = await sb.rpc("approve_supplier_registration", {
      p_request_id: requestId,
      p_supplier_id: supplierId || null,
    });

    if (error) return { error: error.message };
    const result = data as { ok: boolean; error?: string; supplier_id?: string };
    if (!result.ok) return { error: result.error || "Erro ao aprovar." };

    revalidatePath("/admin/fornecedores", "layout");
    return { ok: `Fornecedor "${result.supplier_id}" criado com condições comerciais.` };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

// ---------------------------------------------------------------------------
// Admin: reject registration
// ---------------------------------------------------------------------------

export async function rejectRegistration(requestId: string, notes?: string): Promise<RegistrationActionResult> {
  try {
    await assertAdmin();
    const sb = await createClient();

    const { error } = await sb
      .from("supplier_registration_requests")
      .update({
        status: "rejected",
        admin_notes: notes || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: (await sb.auth.getUser()).data.user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .in("status", ["pending", "correction_requested"]);

    if (error) return { error: error.message };

    revalidatePath("/admin/fornecedores", "layout");
    return { ok: "Solicitação recusada." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

// ---------------------------------------------------------------------------
// Admin: request correction
// ---------------------------------------------------------------------------

export async function requestCorrection(requestId: string, notes: string): Promise<RegistrationActionResult> {
  try {
    await assertAdmin();
    const sb = await createClient();

    const { error } = await sb
      .from("supplier_registration_requests")
      .update({
        status: "correction_requested",
        admin_notes: notes,
        reviewed_at: new Date().toISOString(),
        reviewed_by: (await sb.auth.getUser()).data.user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (error) return { error: error.message };

    revalidatePath("/admin/fornecedores", "layout");
    return { ok: "Correção solicitada." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

// ---------------------------------------------------------------------------
// Admin: data fetchers
// ---------------------------------------------------------------------------

export async function getPendingRegistrationCount(): Promise<number> {
  try {
    const sb = await createClient();
    const { count, error } = await sb
      .from("supplier_registration_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export interface RegistrationRequest {
  id: string;
  invite_id: string;
  trade_name: string;
  name: string;
  cnpj: string | null;
  state: string | null;
  city: string | null;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  pedido_minimo_tipo: string;
  pedido_minimo: number;
  dias_pedido: number[];
  prazo_entrega_cd_dias: number;
  frete_tipo: string;
  frete_gratis_acima: number | null;
  frete_valor: number | null;
  status: string;
  admin_notes: string | null;
  reviewed_at: string | null;
  supplier_id: string | null;
  created_at: string;
}

export async function getRegistrationRequests(): Promise<RegistrationRequest[]> {
  try {
    await assertAdmin();
    const sb = await createClient();
    const { data, error } = await sb
      .from("supplier_registration_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as RegistrationRequest[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public: validate invite token (for the form page)
// ---------------------------------------------------------------------------

export async function validateInviteToken(token: string): Promise<{ valid: boolean; reason?: string; inviteId?: string }> {
  try {
    const sb = createPublicClient();
    if (!sb) return { valid: false, reason: "service_unavailable" };

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data, error } = await sb.rpc("validate_supplier_invite", { p_token_hash: tokenHash });
    if (error) return { valid: false, reason: "error" };

    const result = data as { valid: boolean; reason?: string; invite_id?: string };
    return { valid: result.valid, reason: result.reason, inviteId: result.invite_id };
  } catch {
    return { valid: false, reason: "error" };
  }
}
