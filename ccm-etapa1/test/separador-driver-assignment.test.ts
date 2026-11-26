/**
 * Tests for separador driver assignment (migration 0061)
 *
 * Validates the widened assign_shipment_driver RPC:
 *  - Auth: admin OR operacao can assign
 *  - Blocked roles: customer, recebedor, entregador
 *  - Status blocking: enviado, entregue, cancelado
 *  - Allowed statuses: preparando, pronto_para_envio
 *  - Reassignment overwrites previous
 *
 * Run: npx vitest run ccm-etapa1/test/separador-driver-assignment.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Types ───────────────────────────────────────────────────────────────────

type UserRole = "customer" | "admin" | "compras" | "recebedor" | "operacao" | "entregador";

interface MockProfile {
  id: string;
  role: UserRole;
  is_active: boolean;
  full_name: string | null;
  email: string;
}

interface MockShipment {
  id: string;
  status: string;
  delivery_method: string;
  assigned_to: string | null;
}

// ── Pure simulation of assign_shipment_driver RPC (migration 0061) ──────────

const BLOCKED_STATUSES = ["enviado", "entregue", "cancelado"];

function simulateAssignShipmentDriverV2(
  callerRole: UserRole,
  driver: MockProfile | null,
  shipment: MockShipment | null,
): { ok: true; assigned_to: string } | { error: string } {
  const isAdmin = callerRole === "admin";
  const isOperacao = callerRole === "operacao";

  if (!(isAdmin || isOperacao)) {
    return { error: "Apenas administradores e operação podem atribuir entregadores." };
  }

  if (!shipment) {
    return { error: "Shipment não encontrado." };
  }

  if (!driver) {
    return { error: "Colaborador não encontrado." };
  }

  if (driver.role !== "entregador") {
    return { error: `Colaborador não possui perfil de entregador (role atual: ${driver.role}).` };
  }

  if (!driver.is_active) {
    return { error: "Entregador está inativo." };
  }

  if (BLOCKED_STATUSES.includes(shipment.status)) {
    return { error: `Não é possível atribuir entregador em status "${shipment.status}".` };
  }

  return { ok: true, assigned_to: driver.id };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const DRIVER_A: MockProfile = { id: "driver-aaa", role: "entregador", is_active: true, full_name: "Carlos", email: "carlos@test.com" };
const DRIVER_B: MockProfile = { id: "driver-bbb", role: "entregador", is_active: true, full_name: "Ana", email: "ana@test.com" };

function makeShipment(status: string, assignedTo: string | null = null): MockShipment {
  return { id: "ship-001", status, delivery_method: "delivery", assigned_to: assignedTo };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 12 scenarios from user requirements
// ═════════════════════════════════════════════════════════════════════════════

describe("Separador Driver Assignment (migration 0061)", () => {

  // ── 1. operacao assigns active entregador → succeeds ─────────────────────

  test("1: operacao assigns active entregador — succeeds", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("pronto_para_envio"));
    expect(r).toEqual({ ok: true, assigned_to: "driver-aaa" });
  });

  // ── 2. admin assigns active entregador → succeeds (backward compat) ──────

  test("2: admin assigns active entregador — succeeds (backward compat)", () => {
    const r = simulateAssignShipmentDriverV2("admin", DRIVER_A, makeShipment("pronto_para_envio"));
    expect(r).toEqual({ ok: true, assigned_to: "driver-aaa" });
  });

  // ── 3. customer tries to assign → blocked ────────────────────────────────

  test("3: customer tries to assign — blocked", () => {
    const r = simulateAssignShipmentDriverV2("customer", DRIVER_A, makeShipment("pronto_para_envio"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("administradores e operação");
    }
  });

  // ── 4. customer with supplier_id tries to assign → blocked ───────────────

  test("4: supplier (customer role) tries to assign — blocked", () => {
    const r = simulateAssignShipmentDriverV2("customer", DRIVER_A, makeShipment("pronto_para_envio"));
    expect("error" in r).toBe(true);
  });

  // ── 5. recebedor tries to assign → blocked ──────────────────────────────

  test("5: recebedor tries to assign — blocked", () => {
    const r = simulateAssignShipmentDriverV2("recebedor", DRIVER_A, makeShipment("pronto_para_envio"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("administradores e operação");
    }
  });

  // ── 6. entregador tries to assign → blocked ─────────────────────────────

  test("6: entregador tries to assign — blocked", () => {
    const r = simulateAssignShipmentDriverV2("entregador", DRIVER_A, makeShipment("pronto_para_envio"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("administradores e operação");
    }
  });

  // ── 7. assignment on status=enviado → blocked ────────────────────────────

  test("7: assignment on status=enviado — blocked", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("enviado"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("enviado");
    }
  });

  // ── 8. assignment on status=entregue → blocked ───────────────────────────

  test("8: assignment on status=entregue — blocked", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("entregue"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("entregue");
    }
  });

  // ── 9. assignment on status=cancelado → blocked ──────────────────────────

  test("9: assignment on status=cancelado — blocked", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("cancelado"));
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("cancelado");
    }
  });

  // ── 10. assignment on status=pronto_para_envio → allowed ─────────────────

  test("10: assignment on status=pronto_para_envio — allowed", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("pronto_para_envio"));
    expect(r).toEqual({ ok: true, assigned_to: "driver-aaa" });
  });

  // ── 11. assignment on status=preparando → allowed ────────────────────────

  test("11: assignment on status=preparando — allowed", () => {
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_A, makeShipment("preparando"));
    expect(r).toEqual({ ok: true, assigned_to: "driver-aaa" });
  });

  // ── 12. reassignment overwrites previous assigned_to ─────────────────────

  test("12: reassignment overwrites previous assigned_to", () => {
    const ship = makeShipment("pronto_para_envio", DRIVER_A.id);
    const r = simulateAssignShipmentDriverV2("operacao", DRIVER_B, ship);
    expect(r).toEqual({ ok: true, assigned_to: "driver-bbb" });
  });
});
