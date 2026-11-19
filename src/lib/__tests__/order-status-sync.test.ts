// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import { deriveOrderStatusFromShipments } from "../shipment-lifecycle";
import type { ShipmentStatus } from "../orders";

describe("deriveOrderStatusFromShipments", () => {
  // Case A: 1 shipment entregue → pedido finaliza
  it("Case A: single shipment entregue + paid → pagos", () => {
    const statuses: ShipmentStatus[] = ["entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBe("pagos");
  });

  it("Case A: single shipment entregue + NOT paid → pagamento-pendente", () => {
    const statuses: ShipmentStatus[] = ["entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pendente")).toBe("pagamento-pendente");
  });

  // Case B: 2 shipments, 1 entregue + 1 enviado → pedido NÃO finaliza
  it("Case B: 1 entregue + 1 enviado → null (no change)", () => {
    const statuses: ShipmentStatus[] = ["entregue", "enviado"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBeNull();
  });

  it("Case B: 1 entregue + 1 preparando → null (no change)", () => {
    const statuses: ShipmentStatus[] = ["entregue", "preparando"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBeNull();
  });

  // Case C: 2 shipments, ambos entregues → pedido finaliza
  it("Case C: 2 entregues + paid → pagos", () => {
    const statuses: ShipmentStatus[] = ["entregue", "entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBe("pagos");
  });

  it("Case C: 2 entregues + NOT paid → pagamento-pendente", () => {
    const statuses: ShipmentStatus[] = ["entregue", "entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pendente")).toBe("pagamento-pendente");
  });

  // Case D: retirada — same logic (entregue is entregue regardless of delivery method)
  it("Case D: pickup → entregue + paid → pagos", () => {
    const statuses: ShipmentStatus[] = ["entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBe("pagos");
  });

  // Edge: 1 entregue + 1 cancelado (all terminal, has entregue)
  it("1 entregue + 1 cancelado → finalizes (partial delivery)", () => {
    const statuses: ShipmentStatus[] = ["entregue", "cancelado"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBe("pagos");
  });

  it("1 entregue + 1 cancelado + NOT paid → pagamento-pendente", () => {
    const statuses: ShipmentStatus[] = ["entregue", "cancelado"];
    expect(deriveOrderStatusFromShipments(statuses, "pendente")).toBe("pagamento-pendente");
  });

  // Edge: all cancelled → does NOT finalize (no entregue)
  it("all cancelled → null (no entregue)", () => {
    const statuses: ShipmentStatus[] = ["cancelado", "cancelado"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBeNull();
  });

  // Edge: empty shipments → null
  it("empty → null", () => {
    expect(deriveOrderStatusFromShipments([], "pago")).toBeNull();
  });

  // Edge: 3 shipments, 2 entregue + 1 pronto_para_envio → null
  it("3 shipments: 2 entregue + 1 in progress → null", () => {
    const statuses: ShipmentStatus[] = ["entregue", "entregue", "pronto_para_envio"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBeNull();
  });

  // Edge: 3 shipments, all entregue + paid
  it("3 shipments: all entregue + paid → pagos", () => {
    const statuses: ShipmentStatus[] = ["entregue", "entregue", "entregue"];
    expect(deriveOrderStatusFromShipments(statuses, "pago")).toBe("pagos");
  });
});
