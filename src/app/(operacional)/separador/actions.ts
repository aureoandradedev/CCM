"use server";

import { revalidatePath } from "next/cache";

import { assertRole } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import type { ShipmentStatus } from "@/lib/orders";
import { canTransition } from "@/lib/shipment-lifecycle";
import { SEPARADOR_OCCURRENCE_TYPES, type ActionResult } from "./constants";

export type { ActionResult } from "./constants";

const OPERACAO_ALLOWED_TRANSITIONS: Record<string, ShipmentStatus[]> = {
  aguardando_disponibilidade: ["preparando"],
  preparando: ["pronto_para_envio", "pronto_para_retirada"],
};

function isOperacaoTransitionAllowed(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return OPERACAO_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

function expectedStatusForTarget(target: ShipmentStatus): ShipmentStatus | null {
  for (const [from, targets] of Object.entries(OPERACAO_ALLOWED_TRANSITIONS)) {
    if (targets.includes(target)) return from as ShipmentStatus;
  }
  return null;
}

/** Start preparation: aguardando_disponibilidade → preparando */
export async function startPreparation(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runSeparador(fd, "preparando");
}

/** Finish as pronto_para_envio (delivery) */
export async function finishForShipping(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runSeparador(fd, "pronto_para_envio");
}

/** Finish as pronto_para_retirada (pickup) */
export async function finishForPickup(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runSeparador(fd, "pronto_para_retirada");
}

async function runSeparador(fd: FormData, targetStatus: ShipmentStatus): Promise<ActionResult> {
  try {
    const user = await assertRole(["operacao"]);
    const sb = await createClient();

    const shipmentId = fd.get("shipmentId") as string | null;
    if (!shipmentId) return { error: "ID da entrega é obrigatório." };

    const expectedFrom = expectedStatusForTarget(targetStatus);
    if (!expectedFrom) return { error: "Transição não mapeada." };

    if (!canTransition(expectedFrom, targetStatus)) {
      return { error: `Transição ${expectedFrom} → ${targetStatus} não é válida.` };
    }

    if (!isOperacaoTransitionAllowed(expectedFrom, targetStatus)) {
      return { error: "Sua função não permite esta operação." };
    }

    const { data, error } = await sb.rpc("transition_shipment_status", {
      p_shipment_id: shipmentId,
      p_new_status: targetStatus,
      p_expected: expectedFrom,
      p_actor_kind: "operacao",
      p_actor_id: user.id,
    });

    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    revalidatePath("/separador", "layout");
    return { ok: targetStatus === "preparando" ? "Separação iniciada." : "Separação concluída." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

/** Log an occurrence — restricted to damage and note for operacao. */
export async function logSeparadorOccurrence(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertRole(["operacao"]);
    const sb = await createClient();

    const shipmentId = fd.get("shipmentId") as string | null;
    const type = fd.get("type") as string | null;
    const description = fd.get("description") as string | null;

    if (!shipmentId || !type || !description?.trim()) {
      return { error: "Preencha todos os campos." };
    }

    if (!(SEPARADOR_OCCURRENCE_TYPES as readonly string[]).includes(type)) {
      return { error: `Tipo "${type}" não permitido para separador. Use: ${SEPARADOR_OCCURRENCE_TYPES.join(", ")}.` };
    }

    const { data, error } = await sb.rpc("log_shipment_occurrence", {
      p_shipment_id: shipmentId,
      p_type: type,
      p_description: description.trim(),
      p_actor_kind: "operacao",
      p_actor_id: user.id,
    });

    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    revalidatePath("/separador", "layout");
    return { ok: "Ocorrência registrada." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

/** Assign a driver to a shipment (after separation). */
export async function assignDriver(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await assertRole(["operacao"]);
    const sb = await createClient();

    const shipmentId = fd.get("shipmentId") as string | null;
    const driverId = fd.get("driverId") as string | null;

    if (!shipmentId) return { error: "ID da entrega é obrigatório." };
    if (!driverId) return { error: "Selecione um entregador." };

    const { error } = await sb.rpc("assign_shipment_driver", {
      p_shipment_id: shipmentId,
      p_driver_id: driverId,
    });

    if (error) return { error: error.message };

    revalidatePath("/separador", "layout");
    return { ok: "Entregador atribuído." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

/** Mark an item as picked (item-by-item separation progress). */
export async function markItemPicked(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const user = await assertRole(["operacao"]);
    const sb = await createClient();

    const itemId = fd.get("itemId") as string | null;
    const pickedQtyStr = fd.get("pickedQty") as string | null;

    if (!itemId) return { error: "ID do item é obrigatório." };

    const pickedQty = Number(pickedQtyStr);
    if (!Number.isInteger(pickedQty) || pickedQty < 0) {
      return { error: "Quantidade separada inválida." };
    }

    const { data, error } = await sb.rpc("mark_item_picked", {
      p_item_id: itemId,
      p_picked_qty: pickedQty,
      p_actor_id: user.id,
    });

    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };

    revalidatePath("/separador", "layout");
    return { ok: "Item conferido." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}
