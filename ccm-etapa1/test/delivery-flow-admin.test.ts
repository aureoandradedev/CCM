/**
 * Tests for delivery flow: admin visibility + "marcar separado" button sync
 *
 * Run: npx vitest run ccm-etapa1/test/delivery-flow-admin.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Types ───────────────────────────────────────────────────────────────────

type UserRole = "admin" | "entregador" | "customer" | "operacao" | "compras" | "recebedor";
type ShipmentStatus = "preparando" | "pronto_para_envio" | "enviado" | "entregue" | "cancelado";

interface MockShipment {
  id: string;
  order_id: string;
  order_code: string;
  status: ShipmentStatus;
  delivery_method: "delivery" | "pickup";
  assigned_to: string | null;
  assigned_to_name: string | null;
  customer_name: string;
  address_district: string | null;
  address_city: string | null;
  item_count: number;
}

// ── Pure simulation of RPC visibility logic ─────────────────────────────────

function simulateActiveShipments(
  role: UserRole,
  userId: string,
  allShipments: MockShipment[],
): MockShipment[] {
  const isAdmin = role === "admin";
  const isEntregador = role === "entregador";

  if (!isAdmin && !isEntregador) return [];

  return allShipments.filter((s) => {
    if (s.status === "entregue" || s.status === "cancelado") return false;
    if (isAdmin) return true;
    return s.assigned_to === userId;
  });
}

// ── Pure simulation of "marcar separado" button validation ──────────────────

function simulateMoveToSeparados(
  orderShipments: MockShipment[],
): { ok: boolean; error?: string } {
  const deliveryShips = orderShipments.filter((s) => s.delivery_method === "delivery");
  const notReady = deliveryShips.filter((s) => s.status !== "pronto_para_envio");
  if (notReady.length > 0) {
    return {
      ok: false,
      error: `Separação incompleta: ${notReady.length} entrega(s) ainda em "${notReady[0].status}". Conclua a separação antes de avançar.`,
    };
  }
  return { ok: true };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ENTREGADOR_JOAO = "user-joao";
const ENTREGADOR_MARIA = "user-maria";
const ADMIN_USER = "user-admin";
const CUSTOMER_USER = "user-customer";
const FORNECEDOR_USER = "user-fornecedor";

const SHIPMENTS: MockShipment[] = [
  {
    id: "ship-1",
    order_id: "order-1",
    order_code: "WJ8848",
    status: "pronto_para_envio",
    delivery_method: "delivery",
    assigned_to: ENTREGADOR_JOAO,
    assigned_to_name: "Entregador Joao",
    customer_name: "Cliente A",
    address_district: "Centro",
    address_city: "São Paulo",
    item_count: 3,
  },
  {
    id: "ship-2",
    order_id: "order-2",
    order_code: "WJ9001",
    status: "pronto_para_envio",
    delivery_method: "delivery",
    assigned_to: null,
    assigned_to_name: null,
    customer_name: "Cliente B",
    address_district: "Vila Madalena",
    address_city: "São Paulo",
    item_count: 5,
  },
  {
    id: "ship-3",
    order_id: "order-3",
    order_code: "WJ9002",
    status: "enviado",
    delivery_method: "delivery",
    assigned_to: ENTREGADOR_MARIA,
    assigned_to_name: "Entregador Maria",
    customer_name: "Cliente C",
    address_district: "Pinheiros",
    address_city: "São Paulo",
    item_count: 2,
  },
  {
    id: "ship-4",
    order_id: "order-4",
    order_code: "WJ9003",
    status: "entregue",
    delivery_method: "delivery",
    assigned_to: ENTREGADOR_JOAO,
    assigned_to_name: "Entregador Joao",
    customer_name: "Cliente D",
    address_district: "Mooca",
    address_city: "São Paulo",
    item_count: 1,
  },
  {
    id: "ship-5",
    order_id: "order-5",
    order_code: "WJ9004",
    status: "cancelado",
    delivery_method: "delivery",
    assigned_to: ENTREGADOR_JOAO,
    assigned_to_name: "Entregador Joao",
    customer_name: "Cliente E",
    address_district: "Lapa",
    address_city: "São Paulo",
    item_count: 4,
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Delivery Flow — Admin & Entregador Visibility", () => {
  // ── 1. Admin sees shipment assigned to any entregador ────────────────────

  test("1: admin sees shipment assigned to any entregador", () => {
    const visible = simulateActiveShipments("admin", ADMIN_USER, SHIPMENTS);
    const joaoShip = visible.find((s) => s.id === "ship-1");
    const mariaShip = visible.find((s) => s.id === "ship-3");
    expect(joaoShip).toBeDefined();
    expect(mariaShip).toBeDefined();
  });

  // ── 2. Admin sees shipment without entregador ────────────────────────────

  test("2: admin sees shipment without entregador", () => {
    const visible = simulateActiveShipments("admin", ADMIN_USER, SHIPMENTS);
    const noDriver = visible.find((s) => s.id === "ship-2");
    expect(noDriver).toBeDefined();
    expect(noDriver!.assigned_to).toBeNull();
  });

  // ── 3. Entregador sees only their own ────────────────────────────────────

  test("3: entregador sees only their assigned shipments", () => {
    const visible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("ship-1");
  });

  // ── 4. Entregador A does not see entregador B's shipment ─────────────────

  test("4: entregador A does not see entregador B shipments", () => {
    const joaoVisible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);
    const mariaVisible = simulateActiveShipments("entregador", ENTREGADOR_MARIA, SHIPMENTS);

    expect(joaoVisible.find((s) => s.id === "ship-3")).toBeUndefined();
    expect(mariaVisible.find((s) => s.id === "ship-1")).toBeUndefined();
    expect(mariaVisible).toHaveLength(1);
    expect(mariaVisible[0].id).toBe("ship-3");
  });

  // ── 5. Customer cannot access ────────────────────────────────────────────

  test("5: customer has no visibility", () => {
    const visible = simulateActiveShipments("customer", CUSTOMER_USER, SHIPMENTS);
    expect(visible).toHaveLength(0);
  });

  // ── 6. Fornecedor cannot access ──────────────────────────────────────────

  test("6: fornecedor/compras/recebedor/operacao have no visibility", () => {
    for (const role of ["compras", "recebedor", "operacao"] as UserRole[]) {
      const visible = simulateActiveShipments(role, FORNECEDOR_USER, SHIPMENTS);
      expect(visible).toHaveLength(0);
    }
  });

  // ── 7. separados + pronto_para_envio + assigned_to → visible for driver ──

  test("7: separados + pronto_para_envio + assigned_to appears for motorista", () => {
    const visible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);
    const ship = visible.find((s) => s.id === "ship-1");
    expect(ship).toBeDefined();
    expect(ship!.status).toBe("pronto_para_envio");
    expect(ship!.assigned_to).toBe(ENTREGADOR_JOAO);
  });

  // ── 8. separados + pronto_para_envio + assigned_to NULL → admin only ─────

  test("8: pronto_para_envio + assigned_to NULL visible only for admin", () => {
    const adminVisible = simulateActiveShipments("admin", ADMIN_USER, SHIPMENTS);
    const joaoVisible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);
    const mariaVisible = simulateActiveShipments("entregador", ENTREGADOR_MARIA, SHIPMENTS);

    expect(adminVisible.find((s) => s.id === "ship-2")).toBeDefined();
    expect(joaoVisible.find((s) => s.id === "ship-2")).toBeUndefined();
    expect(mariaVisible.find((s) => s.id === "ship-2")).toBeUndefined();
  });

  // ── 9. "Marcar separado" does NOT change shipment to enviado ─────────────

  test("9: marcar separado does not set shipment to enviado", () => {
    const orderShips: MockShipment[] = [
      { ...SHIPMENTS[0], status: "pronto_para_envio" },
    ];
    const result = simulateMoveToSeparados(orderShips);
    expect(result.ok).toBe(true);
    expect(orderShips[0].status).toBe("pronto_para_envio");
  });

  // ── 10. "Marcar separado" blocks if shipment still preparing ─────────────

  test("10: marcar separado blocks if shipment still preparando", () => {
    const orderShips: MockShipment[] = [
      { ...SHIPMENTS[0], status: "preparando" },
    ];
    const result = simulateMoveToSeparados(orderShips);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("preparando");
    expect(result.error).toContain("Separação incompleta");
  });

  // ── 11. entregue/cancelado do not appear in active queue ─────────────────

  test("11: entregue and cancelado do not appear in active queue", () => {
    const adminVisible = simulateActiveShipments("admin", ADMIN_USER, SHIPMENTS);
    const joaoVisible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);

    expect(adminVisible.find((s) => s.status === "entregue")).toBeUndefined();
    expect(adminVisible.find((s) => s.status === "cancelado")).toBeUndefined();
    expect(joaoVisible.find((s) => s.status === "entregue")).toBeUndefined();
    expect(joaoVisible.find((s) => s.status === "cancelado")).toBeUndefined();
  });
});

describe("WJ8848 Validation", () => {
  test("WJ8848: admin sees it, Joao sees it, shipment stays pronto_para_envio", () => {
    const ship8848 = SHIPMENTS.find((s) => s.order_code === "WJ8848")!;
    expect(ship8848.status).toBe("pronto_para_envio");
    expect(ship8848.assigned_to).toBe(ENTREGADOR_JOAO);
    expect(ship8848.assigned_to_name).toBe("Entregador Joao");

    const adminVisible = simulateActiveShipments("admin", ADMIN_USER, SHIPMENTS);
    expect(adminVisible.find((s) => s.order_code === "WJ8848")).toBeDefined();

    const joaoVisible = simulateActiveShipments("entregador", ENTREGADOR_JOAO, SHIPMENTS);
    expect(joaoVisible.find((s) => s.order_code === "WJ8848")).toBeDefined();

    expect(ship8848.status).toBe("pronto_para_envio");
  });
});
