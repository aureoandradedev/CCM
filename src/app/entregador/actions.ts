"use server";

import { revalidatePath } from "next/cache";

import { assertRole } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import type { ShipmentStatus } from "@/lib/orders";
import { canTransition } from "@/lib/shipment-lifecycle";
import type { OccurrenceType } from "@/lib/shipment-lifecycle";

export interface ActionResult {
  ok?: string;
  error?: string;
}

const ENTREGADOR_ALLOWED_TRANSITIONS: Record<string, ShipmentStatus[]> = {
  pronto_para_envio: ["enviado"],
  enviado: ["entregue"],
};

export const ENTREGADOR_OCCURRENCE_TYPES: OccurrenceType[] = [
  "attempt", "delay", "damage", "return", "note",
];

function isEntregadorTransitionAllowed(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return ENTREGADOR_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

function expectedStatusForTarget(target: ShipmentStatus): ShipmentStatus | null {
  for (const [from, targets] of Object.entries(ENTREGADOR_ALLOWED_TRANSITIONS)) {
    if (targets.includes(target)) return from as ShipmentStatus;
  }
  return null;
}

/** Mark as enviado: pronto_para_envio → enviado */
export async function markShipped(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runEntregador(fd, "enviado");
}

/** Mark as delivered: enviado → entregue */
export async function markDelivered(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runEntregador(fd, "entregue", "enviado");
}

async function runEntregador(
  fd: FormData,
  targetStatus: ShipmentStatus,
  explicitFrom?: ShipmentStatus,
): Promise<ActionResult> {
  try {
    const user = await assertRole(["entregador"]);
    const sb = await createClient();

    const shipmentId = fd.get("shipmentId") as string | null;
    if (!shipmentId) return { error: "ID da entrega é obrigatório." };

    const expectedFrom = explicitFrom ?? expectedStatusForTarget(targetStatus);
    if (!expectedFrom) return { error: "Transição não mapeada." };

    if (!canTransition(expectedFrom, targetStatus)) {
      return { error: `Transição ${expectedFrom} → ${targetStatus} não é válida.` };
    }

    if (!isEntregadorTransitionAllowed(expectedFrom, targetStatus)) {
      return { error: "Sua função não permite esta operação." };
    }

    const { data, error } = await sb.rpc("transition_shipment_status", {
      p_shipment_id: shipmentId,
      p_new_status: targetStatus,
      p_expected: expectedFrom,
      p_actor_kind: "entregador",
      p_actor_id: user.id,
    });

    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    revalidatePath("/entregador", "layout");

    const labels: Record<string, string> = {
      enviado: "Saiu para entrega.",
      entregue: "Entrega confirmada.",
    };
    return { ok: labels[targetStatus] ?? "Status atualizado." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

export async function logEntregadorOccurrence(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertRole(["entregador"]);
    const sb = await createClient();

    const shipmentId = fd.get("shipmentId") as string | null;
    const type = fd.get("type") as string | null;
    const description = fd.get("description") as string | null;

    if (!shipmentId || !type || !description?.trim()) {
      return { error: "Preencha todos os campos." };
    }

    if (!(ENTREGADOR_OCCURRENCE_TYPES as readonly string[]).includes(type)) {
      return { error: `Tipo "${type}" não permitido. Use: ${ENTREGADOR_OCCURRENCE_TYPES.join(", ")}.` };
    }

    const { data, error } = await sb.rpc("log_shipment_occurrence", {
      p_shipment_id: shipmentId,
      p_type: type,
      p_description: description.trim(),
      p_actor_kind: "entregador",
      p_actor_id: user.id,
    });

    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    revalidatePath("/entregador", "layout");
    return { ok: "Ocorrência registrada." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}
