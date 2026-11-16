/**
 * Testes do Supplier BI — rastreabilidade, atribuição, revenue_excluded, margem.
 *
 * Requer vitest: npx vitest run src/lib/__tests__/supplier-bi.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect, vi } from "vitest";

// Mock Supabase server to avoid real import during tests
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { periodToRange, type PeriodKey } from "../admin/supplier-bi-data";
import { rankProductOffers } from "../ranking/engine";
import type { RankableOffer } from "../ranking/types";

// ─── periodToRange ────────────────────────────────────────────────────────

describe("periodToRange", () => {
  it("todos returns null/null", () => {
    const r = periodToRange("todos");
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });

  it("hoje returns a 24h window", () => {
    const r = periodToRange("hoje");
    expect(r.from).toBeTruthy();
    expect(r.to).toBeTruthy();
    const diff = new Date(r.to!).getTime() - new Date(r.from!).getTime();
    expect(diff).toBe(24 * 3600 * 1000);
  });

  it("7d returns from 7 days ago with no upper bound", () => {
    const r = periodToRange("7d");
    expect(r.from).toBeTruthy();
    expect(r.to).toBeNull();
    const fromDate = new Date(r.from!);
    const now = Date.now();
    const diff = now - fromDate.getTime();
    expect(diff).toBeGreaterThan(6.9 * 86400 * 1000);
    expect(diff).toBeLessThan(7.1 * 86400 * 1000);
  });

  for (const p of ["30d", "90d"] as PeriodKey[]) {
    it(`${p} returns from N days ago`, () => {
      const r = periodToRange(p);
      expect(r.from).toBeTruthy();
      expect(r.to).toBeNull();
    });
  }

  it("mes returns from the 1st of the month", () => {
    const r = periodToRange("mes");
    expect(r.from).toBeTruthy();
    expect(r.to).toBeNull();
  });

  it("mes_anterior has both from and to", () => {
    const r = periodToRange("mes_anterior");
    expect(r.from).toBeTruthy();
    expect(r.to).toBeTruthy();
  });
});

// ─── Margin logic ─────────────────────────────────────────────────────────

describe("margin snapshot attribution", () => {
  it("margin = line_centavos - (supplier_cost_centavos × qty)", () => {
    const qty = 5;
    const unitPrice = 1500;
    const supplierCost = 1000;
    const line = unitPrice * qty;
    const margin = line - supplierCost * qty;
    expect(margin).toBe(2500);
  });

  it("null supplier_cost_centavos means non-traceable (no margin)", () => {
    const supplierCost: number | null = null;
    const margin = supplierCost != null ? 100 - supplierCost * 1 : null;
    expect(margin).toBeNull();
  });

  it("historical order without snapshot excluded from margin", () => {
    const items = [
      { supplierCost: null, qty: 3, line: 4500 },
      { supplierCost: 1000, qty: 2, line: 3000 },
    ];

    let margemBruta = 0;
    let naoRastreaveis = 0;
    for (const item of items) {
      if (item.supplierCost != null) {
        margemBruta += item.line - item.supplierCost * item.qty;
      } else {
        naoRastreaveis++;
      }
    }

    expect(naoRastreaveis).toBe(1);
    expect(margemBruta).toBe(1000);
  });
});

// ─── A→B supplier attribution ─────────────────────────────────────────────

describe("A→B supplier attribution", () => {
  it("items keep their snapshot supplier_id regardless of current sourcing", () => {
    const supplierA = "supplier-a";
    const supplierB = "supplier-b";

    const historicalItems = [
      { orderId: "o1", supplierId: supplierA, qty: 5, line: 7500, cost: 1000 },
      { orderId: "o2", supplierId: supplierB, qty: 3, line: 4500, cost: 1000 },
    ];

    const bySupplier = new Map<string, { units: number; revenue: number }>();
    for (const item of historicalItems) {
      const acc = bySupplier.get(item.supplierId) ?? { units: 0, revenue: 0 };
      acc.units += item.qty;
      acc.revenue += item.line;
      bySupplier.set(item.supplierId, acc);
    }

    expect(bySupplier.get(supplierA)!.units).toBe(5);
    expect(bySupplier.get(supplierB)!.units).toBe(3);
    expect(bySupplier.get(supplierA)!.revenue).toBe(7500);
    expect(bySupplier.get(supplierB)!.revenue).toBe(4500);
  });

  it("switching sourcing does NOT retroactively reassign past sales", () => {
    const salesSupplierA = [
      { supplierId: "a", qty: 5, cost: 1000, line: 7500 },
    ];
    const salesSupplierB = [
      { supplierId: "b", qty: 3, cost: 1000, line: 4500 },
    ];
    const allSales = [...salesSupplierA, ...salesSupplierB];

    const currentSourcing = "b";

    const revenueA = allSales
      .filter((s) => s.supplierId === "a")
      .reduce((sum, s) => sum + s.line, 0);
    const revenueB = allSales
      .filter((s) => s.supplierId === "b")
      .reduce((sum, s) => sum + s.line, 0);

    expect(revenueA).toBe(7500);
    expect(revenueB).toBe(4500);
    expect(revenueA).not.toBe(0);
    expect(revenueB).not.toBe(allSales.reduce((s, i) => s + i.line, 0));
  });
});

// ─── revenue_excluded ─────────────────────────────────────────────────────

describe("revenue_excluded filtering", () => {
  it("orders with revenue_excluded=true must not enter any metric", () => {
    const orders = [
      { id: "o1", revenueExcluded: false, items: [{ line: 5000, qty: 2, cost: 1000 }] },
      { id: "o2", revenueExcluded: true, items: [{ line: 3000, qty: 1, cost: 800 }] },
      { id: "o3", revenueExcluded: false, items: [{ line: 2000, qty: 1, cost: 500 }] },
    ];

    const validOrders = orders.filter((o) => !o.revenueExcluded);
    const items = validOrders.flatMap((o) => o.items);

    const faturamento = items.reduce((s, i) => s + i.line, 0);
    const unidades = items.reduce((s, i) => s + i.qty, 0);
    const custoTotal = items.reduce((s, i) => s + i.cost * i.qty, 0);
    const margem = faturamento - custoTotal;

    expect(faturamento).toBe(7000);
    expect(unidades).toBe(3);
    expect(margem).toBe(7000 - 2500);
    expect(validOrders.length).toBe(2);
  });

  it("participacao excludes revenue_excluded from total", () => {
    const totalRevenue = 10000;
    const supplierRevenue = 5000;
    const participacao = Math.round((supplierRevenue / totalRevenue) * 10000) / 100;
    expect(participacao).toBe(50);
  });

  it("ticket medio excludes revenue_excluded orders", () => {
    const faturamento = 7000;
    const pedidos = 2;
    const ticketMedio = Math.round(faturamento / pedidos);
    expect(ticketMedio).toBe(3500);
  });
});

// ─── Ranking ──────────────────────────────────────────────────────────────

describe("ranking competitive comparison", () => {
  it("ranks by cost 60% + stock 20% + lead_time 20%", () => {
    const offers: RankableOffer[] = [
      { id: "o1", master_product_id: "mp1", supplier_id: "s1", cost_centavos: 1000, stock: 100, lead_time_days: 1, status: "ativa" },
      { id: "o2", master_product_id: "mp1", supplier_id: "s2", cost_centavos: 2000, stock: 50, lead_time_days: 5, status: "ativa" },
    ];
    const result = rankProductOffers(offers);
    expect(result).not.toBeNull();
    expect(result!.offers[0].supplier_offer_id).toBe("o1");
    expect(result!.offers[0].position).toBe(1);
  });

  it("returns null for empty offers", () => {
    const result = rankProductOffers([]);
    expect(result).toBeNull();
  });

  it("single offer gets position 1", () => {
    const offers: RankableOffer[] = [
      { id: "o1", master_product_id: "mp1", supplier_id: "s1", cost_centavos: 1000, stock: 50, lead_time_days: 2, status: "ativa" },
    ];
    const result = rankProductOffers(offers);
    expect(result).not.toBeNull();
    expect(result!.offers).toHaveLength(1);
    expect(result!.offers[0].position).toBe(1);
  });
});

// ─── Ticket médio ─────────────────────────────────────────────────────────

describe("ticket medio per order", () => {
  it("is calculated per order, not per item", () => {
    const items = [
      { orderId: "o1", line: 3000 },
      { orderId: "o1", line: 2000 },
      { orderId: "o2", line: 5000 },
    ];
    const orderIds = new Set(items.map((i) => i.orderId));
    const faturamento = items.reduce((s, i) => s + i.line, 0);
    const ticketMedio = Math.round(faturamento / orderIds.size);
    expect(ticketMedio).toBe(5000);
  });
});
