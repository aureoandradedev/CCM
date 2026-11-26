"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSupplierSession } from "@/lib/supplier/guard";

export interface ConfirmationItem {
  lineId: string;
  qtyConfirmed: number;
  status: "confirmado" | "confirmado_parcial" | "indisponivel" | "divergencia_quantidade" | "divergencia_custo" | "revisao_necessaria";
  costConfirmedCentavos?: number | null;
  notes?: string;
}

interface ActionResult {
  ok?: string;
  error?: string;
}

export async function submitSupplierConfirmation(requestId: string, items: ConfirmationItem[]): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { error: "Banco não configurado." };
  const session = await getSupplierSession();
  if (!session) return { error: "Acesso negado." };

  const sb = await createClient();
  const { data, error } = await sb.rpc("confirm_supplier_request_v2", {
    p_request_id: requestId,
    p_supplier_id: session.supplierId,
    p_confirmations: items.map((i) => ({
      line_id: i.lineId,
      qty_confirmed: i.qtyConfirmed,
      status: i.status,
      cost_confirmed_centavos: i.costConfirmedCentavos ?? null,
      notes: i.notes ?? null,
    })),
  });

  if (error) return { error: error.message };

  revalidatePath("/fornecedores/pedidos");
  revalidatePath(`/fornecedores/pedidos/${requestId}`);

  const result = data as { ok: boolean; status?: string; error?: string } | null;
  if (result && !result.ok) return { error: result.error ?? "Erro ao confirmar." };

  // After confirmation, trigger the gate check via backend
  try {
    const { data: req } = await sb
      .from("supplier_requests")
      .select("order_id")
      .eq("id", requestId)
      .maybeSingle();
    if (req?.order_id) {
      const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api").replace(/\/$/, "");
      await fetch(`${API_BASE}/outbox/supplier-gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: req.order_id }),
      }).catch(() => {});
    }
  } catch {}

  return { ok: "Confirmação registrada com sucesso." };
}

export async function uploadRequestMirror(requestId: string, formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { error: "Banco não configurado." };
  const session = await getSupplierSession();
  if (!session) return { error: "Acesso negado." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Arquivo obrigatório." };

  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) return { error: "Formato não suportado. Use PDF, JPEG, PNG ou WebP." };
  if (file.size > 10 * 1024 * 1024) return { error: "Arquivo muito grande (máx. 10 MB)." };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const path = `${session.supplierId}/${requestId}/${crypto.randomUUID()}.${ext}`;

  const sb = await createClient();
  const { error: uploadErr } = await sb.storage.from("espelhos").upload(path, file, { upsert: false });
  if (uploadErr) return { error: `Upload falhou: ${uploadErr.message}` };

  const fileType = ext === "jpg" ? "jpeg" : ext;
  const { error: insertErr } = await sb.from("supplier_request_mirrors").insert({
    supplier_request_id: requestId,
    supplier_id: session.supplierId,
    uploaded_by: session.userId,
    file_path: path,
    file_type: fileType,
    file_size_bytes: file.size,
  });
  if (insertErr) return { error: `Registro falhou: ${insertErr.message}` };

  revalidatePath(`/fornecedores/pedidos/${requestId}`);
  return { ok: "Espelho anexado." };
}
