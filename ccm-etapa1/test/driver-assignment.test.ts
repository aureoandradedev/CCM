/**
 * Tests for driver assignment bridge (admin → entregador)
 *
 * Validates:
 * 1: Admin assigns active entregador — succeeds
 * 2: Admin tries to assign wrong role — blocked by RPC
 * 3: Inactive entregador — blocked by RPC
 * 4: Non-admin caller — blocked by RPC
 * 5: Reassignment works — overwrites previous assigned_to
 * 6: Entregador RPC scoping — only sees own assigned shipments
 *
 * Run: npx vitest run ccm-etapa1/test/driver-assignment.test.ts
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

// ── Pure simulation of assign_shipment_driver RPC (migration 0041) ──────────

function simulateAssignShipmentDriver(
  callerRole: UserRole,
  driver: MockProfile | null,
  shipment: MockShipment | null,
): { ok: true; assigned_to: string } | { error: string } {
  if (callerRole !== "admin") {
    return { error: "Apenas administradores podem atribuir entregadores." };
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
  return { ok: true, assigned_to: driver.id };
}

// ── Pure simulation of entregador_active_shipments RPC (migration 0046) ─────

function simulateEntregadorActiveShipments(
  callerId: string,
  callerRole: UserRole,
  callerIsActive: boolean,
  allShipments: MockShipment[],
): MockShipment[] | { error: string } {
  if (callerRole !== "entregador") {
    return { error: "Acesso negado: perfil não é entregador." };
  }
  if (!callerIsActive) {
    return { error: "Entregador está inativo." };
  }
  return allShipments.filter(
    (s) =>
      s.assigned_to === callerId &&
      s.delivery_method === "delivery" &&
      ["pronto_para_envio", "enviado"].includes(s.status),
  );
}

// ── Pure simulation of listActiveDrivers query ──────────────────────────────

function simulateListActiveDrivers(profiles: MockProfile[]): Pick<MockProfile, "id" | "full_name" | "email">[] {
  return profiles
    .filter((p) => p.role === "entregador" && p.is_active)
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
    .map(({ id, full_name, email }) => ({ id, full_name, email }));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN: MockProfile = { id: "admin-001", role: "admin", is_active: true, full_name: "Admin", email: "admin@test.com" };
const DRIVER_A: MockProfile = { id: "driver-aaa", role: "entregador", is_active: true, full_name: "Carlos Entregador", email: "carlos@test.com" };
const DRIVER_B: MockProfile = { id: "driver-bbb", role: "entregador", is_active: true, full_name: "Ana Entregadora", email: "ana@test.com" };
const INACTIVE_DRIVER: MockProfile = { id: "driver-ccc", role: "entregador", is_active: false, full_name: "Inativo", email: "inativo@test.com" };
const COMPRAS_USER: MockProfile = { id: "compras-001", role: "compras", is_active: true, full_name: "Compras", email: "compras@test.com" };
const OPERACAO_USER: MockProfile = { id: "operacao-001", role: "operacao", is_active: true, full_name: "Separador", email: "sep@test.com" };

const SHIPMENT_DELIVERY: MockShipment = { id: "ship-001", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: null };
const SHIPMENT_PICKUP: MockShipment = { id: "ship-002", status: "pronto_para_retirada", delivery_method: "pickup", assigned_to: null };

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Driver Assignment Bridge", () => {
  // ── 1: Admin assigns active entregador ────────────────────────────────────

  test("1: admin assigns active entregador — succeeds", () => {
    const result = simulateAssignShipmentDriver("admin", DRIVER_A, SHIPMENT_DELIVERY);
    expect(result).toEqual({ ok: true, assigned_to: "driver-aaa" });
  });

  // ── 2: Wrong role blocked ─────────────────────────────────────────────────

  test("2: admin assigns compras user — blocked (wrong role)", () => {
    const result = simulateAssignShipmentDriver("admin", COMPRAS_USER, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("entregador");
      expect(result.error).toContain("compras");
    }
  });

  test("2b: admin assigns operacao user — blocked (wrong role)", () => {
    const result = simulateAssignShipmentDriver("admin", OPERACAO_USER, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("entregador");
    }
  });

  // ── 3: Inactive entregador blocked ────────────────────────────────────────

  test("3: inactive entregador — blocked by RPC", () => {
    const result = simulateAssignShipmentDriver("admin", INACTIVE_DRIVER, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("inativo");
    }
  });

  // ── 4: Non-admin caller blocked ───────────────────────────────────────────

  test("4a: compras user tries to assign — blocked", () => {
    const result = simulateAssignShipmentDriver("compras", DRIVER_A, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("administradores");
    }
  });

  test("4b: entregador tries to assign — blocked", () => {
    const result = simulateAssignShipmentDriver("entregador", DRIVER_A, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("administradores");
    }
  });

  test("4c: operacao user tries to assign — blocked", () => {
    const result = simulateAssignShipmentDriver("operacao", DRIVER_A, SHIPMENT_DELIVERY);
    expect("error" in result).toBe(true);
  });

  // ── 5: Reassignment overwrites previous ───────────────────────────────────

  test("5: reassignment overwrites assigned_to", () => {
    const assigned = { ...SHIPMENT_DELIVERY, assigned_to: DRIVER_A.id };

    const result = simulateAssignShipmentDriver("admin", DRIVER_B, assigned);
    expect(result).toEqual({ ok: true, assigned_to: "driver-bbb" });
  });

  // ── 6: Entregador scope — only sees own shipments ─────────────────────────

  test("6a: entregador sees only their assigned shipments", () => {
    const shipments: MockShipment[] = [
      { id: "s1", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: "driver-aaa" },
      { id: "s2", status: "enviado", delivery_method: "delivery", assigned_to: "driver-bbb" },
      { id: "s3", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: "driver-aaa" },
      { id: "s4", status: "entregue", delivery_method: "delivery", assigned_to: "driver-aaa" },
      { id: "s5", status: "pronto_para_retirada", delivery_method: "pickup", assigned_to: "driver-aaa" },
    ];

    const result = simulateEntregadorActiveShipments("driver-aaa", "entregador", true, shipments);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((s) => s.id)).toEqual(["s1", "s3"]);
    }
  });

  test("6b: entregador B does not see entregador A shipments", () => {
    const shipments: MockShipment[] = [
      { id: "s1", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: "driver-aaa" },
      { id: "s2", status: "enviado", delivery_method: "delivery", assigned_to: "driver-bbb" },
    ];

    const resultA = simulateEntregadorActiveShipments("driver-aaa", "entregador", true, shipments);
    const resultB = simulateEntregadorActiveShipments("driver-bbb", "entregador", true, shipments);

    expect(Array.isArray(resultA) && resultA.map((s) => s.id)).toEqual(["s1"]);
    expect(Array.isArray(resultB) && resultB.map((s) => s.id)).toEqual(["s2"]);
  });

  test("6c: non-entregador role cannot call entregador RPC", () => {
    const shipments: MockShipment[] = [
      { id: "s1", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: "admin-001" },
    ];
    const result = simulateEntregadorActiveShipments("admin-001", "admin", true, shipments);
    expect("error" in result).toBe(true);
  });

  test("6d: inactive entregador gets empty", () => {
    const shipments: MockShipment[] = [
      { id: "s1", status: "pronto_para_envio", delivery_method: "delivery", assigned_to: "driver-ccc" },
    ];
    const result = simulateEntregadorActiveShipments("driver-ccc", "entregador", false, shipments);
    expect("error" in result).toBe(true);
  });
});

describe("listActiveDrivers", () => {
  test("returns only active entregadores sorted by name", () => {
    const profiles = [ADMIN, DRIVER_A, DRIVER_B, INACTIVE_DRIVER, COMPRAS_USER];
    const result = simulateListActiveDrivers(profiles);
    expect(result).toEqual([
      { id: "driver-bbb", full_name: "Ana Entregadora", email: "ana@test.com" },
      { id: "driver-aaa", full_name: "Carlos Entregador", email: "carlos@test.com" },
    ]);
  });

  test("returns empty when no entregadores exist", () => {
    const profiles = [ADMIN, COMPRAS_USER, OPERACAO_USER];
    const result = simulateListActiveDrivers(profiles);
    expect(result).toEqual([]);
  });

  test("excludes inactive entregadores", () => {
    const profiles = [INACTIVE_DRIVER];
    const result = simulateListActiveDrivers(profiles);
    expect(result).toEqual([]);
  });
});
