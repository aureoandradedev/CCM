/**
 * Pipeline de sincronização de integração (Fase 8).
 *
 * Fluxo: connector payload → validar contrato → criar batch → converter
 * para catálogo CCM → supplier_catalog_items → finalizar batch.
 *
 * NÃO executa: matching, ranking, sourcing, publicação.
 * O admin decide quando avançar nas fases internas.
 */
import { z } from "zod";

import type {
  ExternalCatalogItem,
  BatchStatus,
  IntegrationErrorKind,
} from "./types";

// ─── Validação do contrato canônico ─────────────────────────────────────────

export const externalCatalogItemSchema = z.object({
  external_id: z.string().min(1, "external_id obrigatorio"),
  supplier_sku: z.string().optional(),
  ean: z.string().optional(),
  name: z.string().min(1, "Nome obrigatorio"),
  description: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  unit: z.string().optional(),
  pack_info: z.string().optional(),
  cost_centavos: z.number().int().positive("Custo deve ser positivo"),
  stock: z.number().int().min(0).nullable().optional(),
  lead_time_days: z.number().int().min(0).optional(),
  image_url: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  available: z.boolean().optional(),
  updated_at: z.string().optional(),
});

export interface ItemValidation {
  item: ExternalCatalogItem;
  valid: boolean;
  errors: string[];
}

export function validateExternalItem(raw: unknown): ItemValidation {
  const parsed = externalCatalogItemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      item: raw as ExternalCatalogItem,
      valid: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  }
  return { item: parsed.data as ExternalCatalogItem, valid: true, errors: [] };
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

const MAX_SYNCS_PER_HOUR = 3;
const MAX_TESTS_PER_HOUR = 5;
const SYNC_TIMEOUT_MINUTES = 30;

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
}

export function checkSyncRateLimit(
  syncCount: number,
  lastSyncAt: string | null,
  syncStartedAt: string | null,
): RateLimitCheck {
  if (syncStartedAt) {
    const elapsed = Date.now() - new Date(syncStartedAt).getTime();
    if (elapsed < SYNC_TIMEOUT_MINUTES * 60 * 1000) {
      return { allowed: false, reason: "Sincronizacao ja em andamento." };
    }
  }

  if (lastSyncAt) {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    if (
      new Date(lastSyncAt).getTime() > hourAgo &&
      syncCount >= MAX_SYNCS_PER_HOUR
    ) {
      return {
        allowed: false,
        reason: `Limite de ${MAX_SYNCS_PER_HOUR} sincronizacoes por hora atingido.`,
      };
    }
  }

  return { allowed: true };
}

export function checkTestRateLimit(
  testCount: number,
  lastSyncAt: string | null,
): RateLimitCheck {
  if (lastSyncAt) {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    if (
      new Date(lastSyncAt).getTime() > hourAgo &&
      testCount >= MAX_TESTS_PER_HOUR
    ) {
      return {
        allowed: false,
        reason: `Limite de ${MAX_TESTS_PER_HOUR} testes por hora atingido.`,
      };
    }
  }
  return { allowed: true };
}

// ─── Resultado do sync ──────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean;
  batchId?: string;
  catalogId?: string;
  status: BatchStatus;
  total: number;
  created: number;
  updated: number;
  ignored: number;
  errors: number;
  deactivated: number;
  errorKind?: IntegrationErrorKind;
  errorMessage?: string;
}

// ─── Pipeline principal ─────────────────────────────────────────────────────

type SupabaseClient = {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => { select: (cols: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } };
    update: (patch: Record<string, unknown>) => { eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }> };
  };
};

export async function runSync(
  sb: SupabaseClient,
  integrationId: string,
  supplierId: string,
  items: ExternalCatalogItem[],
  syncType: "full" | "delta" = "full",
  cursorBefore?: string,
  cursorAfter?: string,
): Promise<SyncResult> {
  const empty: SyncResult = {
    ok: false,
    status: "failed",
    total: 0,
    created: 0,
    updated: 0,
    ignored: 0,
    errors: 0,
    deactivated: 0,
  };

  // 1. Acquire lock
  const { data: locked, error: lockErr } = await sb.rpc(
    "acquire_sync_lock",
    { p_integration_id: integrationId },
  );
  if (lockErr || !locked) {
    return {
      ...empty,
      total: items.length,
      errors: items.length,
      errorKind: "internal_error",
      errorMessage:
        lockErr?.message ??
        "Sincronizacao ja em andamento ou integracao nao conectada.",
    };
  }

  let finalStatus: BatchStatus = "completed";
  let errorMessage: string | undefined;

  try {
    // 2. Create catalog record
    const { data: catalog, error: catErr } = await sb
      .from("supplier_catalogs")
      .insert({
        supplier_id: supplierId,
        source: "api",
        source_name: `sync-${integrationId}`,
        status: "processando",
        total_items: items.length,
      })
      .select("id")
      .single();

    if (catErr || !catalog) {
      throw new Error(catErr?.message ?? "Erro ao criar catalogo.");
    }
    const catalogId = catalog.id as string;

    // 3. Create batch record
    const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const { error: batchErr } = await sb
      .from("integration_import_batches")
      .insert({
        id: batchId,
        supplier_id: supplierId,
        integration_id: integrationId,
        method: syncType,
        source_name: `integration:${integrationId}`,
        total: items.length,
        status: "running",
        sync_type: syncType,
        cursor_before: cursorBefore ?? null,
        cursor_after: cursorAfter ?? null,
      })
      .select("id")
      .single();

    if (batchErr) throw new Error(batchErr.message);

    // 4. Validate and upsert items
    let created = 0,
      updated = 0,
      ignored = 0,
      errors = 0;
    const errorMessages: string[] = [];

    for (const rawItem of items) {
      const validation = validateExternalItem(rawItem);
      if (!validation.valid) {
        errors++;
        if (errorMessages.length < 10) {
          errorMessages.push(
            `${rawItem.external_id ?? "?"}: ${validation.errors.join("; ")}`,
          );
        }
        continue;
      }

      const itemData: Record<string, unknown> = {
        supplier_sku: validation.item.supplier_sku,
        ean: validation.item.ean,
        name: validation.item.name,
        description: validation.item.description,
        brand: validation.item.brand,
        model: validation.item.model,
        category: validation.item.category,
        subcategory: validation.item.subcategory,
        unit: validation.item.unit,
        pack_info: validation.item.pack_info,
        cost_centavos: validation.item.cost_centavos,
        stock: validation.item.stock,
        lead_time_days: validation.item.lead_time_days,
        image_url: validation.item.image_url ?? validation.item.images?.[0],
        attributes: validation.item.attributes ?? {},
        available: validation.item.available,
      };

      const { data: result, error: upsertErr } = await sb.rpc(
        "upsert_catalog_item",
        {
          p_catalog_id: catalogId,
          p_supplier_id: supplierId,
          p_integration_id: integrationId,
          p_external_id: validation.item.external_id,
          p_batch_id: batchId,
          p_data: itemData,
        },
      );

      if (upsertErr) {
        errors++;
        if (errorMessages.length < 10) {
          errorMessages.push(
            `${validation.item.external_id}: ${upsertErr.message}`,
          );
        }
        continue;
      }

      const action = result as string;
      if (action === "created") created++;
      else if (action === "updated") updated++;
      else ignored++;
    }

    // 5. Finalize batch
    finalStatus =
      errors > 0 && created + updated > 0
        ? "partial"
        : errors > 0
          ? "failed"
          : "completed";
    const errorSummary =
      errorMessages.length > 0 ? errorMessages.join("\n") : null;

    await sb
      .from("integration_import_batches")
      .update({
        finished_at: new Date().toISOString(),
        status: finalStatus,
        valid: created + updated + ignored,
        invalid: errors,
        items_created: created,
        items_updated: updated,
        items_ignored: ignored,
        error_count: errors,
        error_summary: errorSummary,
      })
      .eq("id", batchId);

    await sb
      .from("supplier_catalogs")
      .update({
        status: finalStatus === "failed" ? "com_erros" : "concluido",
        processed: created + updated + ignored,
        errors,
      })
      .eq("id", catalogId);

    await sb
      .from("supplier_integrations")
      .update({
        product_count: created + updated + ignored,
        valid_count: created + updated,
        error_count: errors,
        last_cursor: cursorAfter ?? null,
      })
      .eq("id", integrationId);

    // Full sync completed → deactivate items not seen in this batch.
    // NEVER on partial/failed (could deactivate thousands by mistake).
    // NEVER on delta sync (absence ≠ removal; only explicit available=false).
    let deactivated = 0;
    if (syncType === "full" && finalStatus === "completed") {
      const { data: deactCount } = await sb.rpc("deactivate_unseen_items", {
        p_integration_id: integrationId,
        p_batch_id: batchId,
      });
      deactivated = (deactCount as number) ?? 0;
    }

    return {
      ok: finalStatus !== "failed",
      batchId,
      catalogId,
      status: finalStatus,
      total: items.length,
      created,
      updated,
      ignored,
      errors,
      deactivated,
      errorMessage: errorSummary ?? undefined,
    };
  } catch (err) {
    finalStatus = "failed";
    errorMessage = (err as Error).message;
    return {
      ...empty,
      total: items.length,
      errors: items.length,
      errorKind: "internal_error",
      errorMessage,
    };
  } finally {
    await sb.rpc("release_sync_lock", {
      p_integration_id: integrationId,
      p_new_status: finalStatus === "failed" ? "error" : "connected",
      p_error: errorMessage ?? null,
    });
  }
}
