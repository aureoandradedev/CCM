"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isValidCNPJ, isValidCPF, isValidEmail, maskPhone, onlyDigits } from "@/lib/utils/masks";
import type { ActionState } from "@/app/conta/actions";
import type { CanonicalProduct } from "@/lib/integrations/types";

// ── Limites ──────────────────────────────────────────────────────────
const MAX_ITEMS = 5_000;
const BATCH_SIZE = 500;
const MAX_SKU = 100;
const MAX_NAME = 500;
const MAX_DESC = 5_000;
const MAX_BRAND = 200;
const MAX_CATEGORY = 200;
const MAX_UNIT = 20;
const MAX_URL = 2_048;
const MAX_SOURCE_NAME = 200;
const MAX_COST_REAIS = 100_000;
const MAX_STOCK = 999_999;

// ── Validação server-side (nunca confiar no frontend) ────────────────
const productSchema = z.object({
  sku: z.string().min(1).max(MAX_SKU),
  name: z.string().min(1).max(MAX_NAME),
  price: z.number().positive().max(MAX_COST_REAIS),
  stock: z.number().int().min(0).max(MAX_STOCK),
  gtin: z.string().max(20).optional(),
  description: z.string().max(MAX_DESC).optional(),
  brand: z.string().max(MAX_BRAND).optional(),
  model: z.string().max(MAX_BRAND).optional(),
  category: z.string().max(MAX_CATEGORY).optional(),
  subcategory: z.string().max(MAX_CATEGORY).optional(),
  unit: z.string().max(MAX_UNIT).optional(),
  packInfo: z.string().max(100).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  promoPrice: z.number().positive().max(MAX_COST_REAIS).optional(),
  weightKg: z.number().positive().max(10_000).optional(),
  images: z.array(z.string().max(MAX_URL)).max(10).optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
});

const importInputSchema = z.object({
  sourceType: z.enum(["csv", "xlsx", "manual"]),
  sourceName: z.string().max(MAX_SOURCE_NAME).optional(),
  products: z.array(productSchema).min(1).max(MAX_ITEMS),
  totals: z.object({
    total: z.number().int().min(0).max(MAX_ITEMS * 2),
    valid: z.number().int().min(0).max(MAX_ITEMS),
    invalid: z.number().int().min(0).max(MAX_ITEMS * 2),
    warnings: z.number().int().min(0).max(MAX_ITEMS * 2),
  }),
});

// ── Tipos de retorno ─────────────────────────────────────────────────

export interface CatalogImportInput {
  sourceType: "csv" | "xlsx" | "manual";
  sourceName: string;
  products: CanonicalProduct[];
  totals: { total: number; valid: number; invalid: number; warnings: number };
}

export interface CatalogImportResult {
  ok: boolean;
  catalogId?: string;
  error?: string;
  errorCode?: "auth_required" | "supplier_not_linked";
  counts?: { total: number; inserted: number; errors: number; warnings: number };
}

// ── Tipos onboarding ────────────────────────────────────────────────

export interface OnboardingStatus {
  authenticated: boolean;
  linked: boolean;
  pending: { id: string; supplierName: string; requestedAt: string } | null;
}

export interface SupplierRegistrationResult {
  ok: boolean;
  error?: string;
  supplierId?: string;
  conflict?: boolean;
}

// ── Server action ────────────────────────────────────────────────────

export async function importCatalog(input: CatalogImportInput): Promise<CatalogImportResult> {
  // ── 1. Validação server-side (payload pode ser forjado) ──
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Dados inválidos: ${issue?.path.join(".") || "?"} — ${issue?.message ?? "formato inesperado"}`,
    };
  }
  const data = parsed.data;

  // ── 2. Autenticação + supplier_id da sessão (NUNCA do input) ──
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, error: "Faça login para importar seu catálogo.", errorCode: "auth_required" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("supplier_id")
    .eq("id", user.id)
    .single();

  if (!profile?.supplier_id) {
    return { ok: false, error: "Sua conta não está vinculada a um fornecedor.", errorCode: "supplier_not_linked" };
  }

  const supplierId = profile.supplier_id;

  // ── 3. Criar catálogo (status=recebido; nunca "processando" síncrono) ──
  const source = data.sourceType === "manual" ? "manual" : "csv";

  const { data: catalog, error: catalogError } = await supabase
    .from("supplier_catalogs")
    .insert({
      supplier_id: supplierId,
      source,
      source_name: data.sourceName || null,
      status: "recebido",
      total_items: data.totals.total,
      processed: 0,
      errors: data.totals.invalid,
      warnings: data.totals.warnings,
    })
    .select("id")
    .single();

  if (catalogError || !catalog) {
    return { ok: false, error: "Erro ao criar catálogo. Tente novamente." };
  }

  // ── 4. Inserir itens em lotes — tudo ou nada ──
  // Se qualquer lote falha, apagamos o catálogo inteiro (ON DELETE CASCADE
  // em supplier_catalog_items.catalog_id remove itens parciais).
  const products = data.products;
  let insertedCount = 0;

  try {
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const rows = batch.map((p) => ({
        catalog_id: catalog.id,
        supplier_id: supplierId,
        supplier_sku: p.sku || null,
        ean: p.gtin || null,
        name: p.name,
        description: p.description || null,
        brand: p.brand || null,
        model: p.model || null,
        category_original: p.category || null,
        subcategory_original: p.subcategory || null,
        unit: p.unit || null,
        pack_info: p.packInfo || null,
        cost_centavos: p.price != null ? Math.round(p.price * 100) : null,
        stock: typeof p.stock === "number" ? p.stock : null,
        lead_time_days: typeof p.leadTimeDays === "number" ? p.leadTimeDays : null,
        image_url: p.images?.[0] || null,
        attributes: {
          ...(p.weightKg != null ? { weight_kg: p.weightKg } : {}),
          ...(p.images && p.images.length > 1
            ? { extra_images: p.images.slice(1) }
            : {}),
        },
        match_status: "pendente" as const,
      }));

      const { error: insertError } = await supabase
        .from("supplier_catalog_items")
        .insert(rows);

      if (insertError) throw insertError;
      insertedCount += batch.length;
    }
  } catch {
    // Falha parcial → apagar catálogo (cascade remove itens já inseridos)
    await supabase.from("supplier_catalogs").delete().eq("id", catalog.id);
    return { ok: false, error: "Erro ao salvar itens do catálogo. Nenhum dado foi gravado." };
  }

  // ── 5. Sucesso → atualizar status de uma vez ──
  await supabase
    .from("supplier_catalogs")
    .update({ status: "analisado", processed: insertedCount })
    .eq("id", catalog.id);

  return {
    ok: true,
    catalogId: catalog.id,
    counts: {
      total: data.totals.total,
      inserted: insertedCount,
      errors: data.totals.invalid,
      warnings: data.totals.warnings,
    },
  };
}

// ── Onboarding: registrar empresa / solicitar acesso ────────────────

const UFS = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

const registrationSchema = z.object({
  cnpj: z.string().length(14),
  trade_name: z.string().min(3).max(200),
  name: z.string().min(2).max(200),
  contact_phone: z.string().min(10).max(20),
  contact_email: z.string().email().max(200),
  city: z.string().min(2).max(100),
  state: z.string().length(2),
});

export async function registerSupplier(input: {
  cnpj: string;
  trade_name: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  city: string;
  state: string;
}): Promise<SupplierRegistrationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Faça login primeiro." };

  const digits = onlyDigits(input.cnpj);
  if (!isValidCNPJ(digits)) return { ok: false, error: "CNPJ inválido." };
  if (!UFS.has(input.state.toUpperCase())) return { ok: false, error: "UF inválida." };

  const parsed = registrationSchema.safeParse({
    ...input,
    cnpj: digits,
    contact_phone: onlyDigits(input.contact_phone),
    state: input.state.toUpperCase(),
  });
  if (!parsed.success) {
    return { ok: false, error: `Dados inválidos: ${parsed.error.issues[0]?.message ?? "verifique os campos."}` };
  }
  const d = parsed.data;

  const { data: result, error: rpcErr } = await supabase.rpc("register_supplier_and_link", {
    p_cnpj: d.cnpj,
    p_name: d.name,
    p_trade_name: d.trade_name,
    p_contact_phone: d.contact_phone,
    p_contact_email: d.contact_email,
    p_city: d.city,
    p_state: d.state,
  });

  if (rpcErr) return { ok: false, error: "Erro ao cadastrar fornecedor. Tente novamente." };

  const res = result as { ok: boolean; error?: string; supplierId?: string; conflict?: boolean };
  if (!res.ok) return { ok: false, error: res.error ?? "Erro inesperado.", conflict: res.conflict };
  return { ok: true, supplierId: res.supplierId };
}

export async function requestSupplierAccess(cnpj: string): Promise<SupplierRegistrationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Faça login primeiro." };

  const digits = onlyDigits(cnpj);
  if (!isValidCNPJ(digits)) return { ok: false, error: "CNPJ inválido." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("supplier_id")
    .eq("id", user.id)
    .single();
  if (profile?.supplier_id) return { ok: false, error: "Sua conta já está vinculada a um fornecedor." };

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("cnpj", digits)
    .single();
  if (!supplier) return { ok: false, error: "Nenhuma empresa encontrada com este CNPJ." };

  const { error: reqErr } = await supabase.from("supplier_access_requests").insert({
    supplier_id: supplier.id,
    profile_id: user.id,
    status: "pending",
  });

  if (reqErr) {
    if (/unique|duplicate/i.test(reqErr.message) || reqErr.code === "23505") {
      return { ok: false, error: "Já existe uma solicitação pendente para esta empresa." };
    }
    return { ok: false, error: "Erro ao criar solicitação. Tente novamente." };
  }

  return { ok: true, supplierId: supplier.id };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { authenticated: false, linked: false, pending: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("supplier_id")
    .eq("id", user.id)
    .single();

  if (profile?.supplier_id) return { authenticated: true, linked: true, pending: null };

  const { data: request } = await supabase
    .from("supplier_access_requests")
    .select("id, supplier_id, requested_at, suppliers(name)")
    .eq("profile_id", user.id)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (request) {
    const sup = request.suppliers as unknown as Record<string, unknown> | null;
    const supplierName = (sup?.name as string) ?? request.supplier_id;
    return {
      authenticated: true,
      linked: false,
      pending: { id: request.id, supplierName, requestedAt: request.requested_at },
    };
  }

  return { authenticated: true, linked: false, pending: null };
}

// ── Auth para modal de importação (sem redirect) ────────────────────

const NOT_CONFIGURED = "Banco de dados ainda não configurado.";

async function siteUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${proto}://${host}`;
}

export async function signInForImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isValidEmail(email) || password.length < 6) return { error: "Confira e-mail e senha." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login/i.test(error.message)) return { error: "E-mail ou senha incorretos." };
    if (/not confirmed/i.test(error.message)) return { error: "Confirme seu e-mail antes de entrar." };
    return { error: error.message };
  }
  return { ok: "Autenticado!" };
}

export async function signUpForImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const document = onlyDigits(formData.get("document"));
  const phone = onlyDigits(formData.get("phone"));

  if (fullName.length < 3) return { error: "Digite seu nome completo." };
  if (!isValidEmail(email)) return { error: "E-mail inválido." };
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (!isValidCPF(document) && !isValidCNPJ(document)) return { error: "CPF ou CNPJ inválido." };
  if (phone.length < 10) return { error: "WhatsApp com DDD." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=/fornecedores/integrar`,
      data: {
        full_name: fullName,
        document,
        phone: maskPhone(phone),
        person_type: document.length === 14 ? "pj" : "pf",
      },
    },
  });
  if (error) {
    if (/already registered/i.test(error.message)) return { error: "Este e-mail já tem conta. Tente entrar." };
    return { error: error.message };
  }
  if (!data.session) return { ok: "Conta criada! Confirme seu e-mail e volte para fazer login." };
  return { ok: "Conta criada!" };
}
