/**
 * Testes das regras de negócio CCM (Fases 10–20).
 *
 * Requer vitest: npx vitest run src/lib/__tests__/purchase-cycle.test.ts
 * Ou: npm i -D vitest && npx vitest
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import {
  nextOrderDay,
  addBusinessDays,
  calculateExpectedAvailabilityDate,
  calculatePackagePurchase,
  checkPriceChangeLimit,
  calculateBoxPrice,
} from "../purchase-cycle";

// ============================================================================
// R4.2 — nextOrderDay
// ============================================================================
describe("nextOrderDay", () => {
  it("retorna próximo dia de pedido a partir de uma quarta", () => {
    // Quarta = getDay() === 3
    const wed = new Date("2026-11-04T12:00:00"); // quarta
    const result = nextOrderDay([2, 5], wed); // terça e sexta
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(5); // sexta
    expect(result!.toISOString().slice(0, 10)).toBe("2026-11-06");
  });

  it("retorna hoje se hoje é dia de pedido e afterCutoff=false", () => {
    const fri = new Date("2026-11-06T12:00:00"); // sexta
    const result = nextOrderDay([5], fri, false);
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe("2026-11-06");
  });

  it("pula para próxima semana se afterCutoff=true", () => {
    const fri = new Date("2026-11-06T12:00:00"); // sexta
    const result = nextOrderDay([5], fri, true);
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe("2026-11-13");
  });

  it("retorna null para dias vazios", () => {
    expect(nextOrderDay([], new Date())).toBeNull();
  });

  it("retorna null para null", () => {
    expect(nextOrderDay(null as unknown as number[], new Date())).toBeNull();
  });
});

// ============================================================================
// R4.2 — addBusinessDays
// ============================================================================
describe("addBusinessDays", () => {
  it("adiciona 2 dias úteis a uma sexta → terça", () => {
    const fri = new Date("2026-11-06T12:00:00"); // sexta
    const result = addBusinessDays(fri, 2);
    expect(result.toISOString().slice(0, 10)).toBe("2026-11-10"); // terça
  });

  it("adiciona 0 dias → retorna mesma data", () => {
    const mon = new Date("2026-11-09T12:00:00");
    const result = addBusinessDays(mon, 0);
    expect(result.toISOString().slice(0, 10)).toBe("2026-11-09");
  });

  it("adiciona 5 dias úteis a segunda → segunda seguinte", () => {
    const mon = new Date("2026-11-09T12:00:00");
    const result = addBusinessDays(mon, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-11-16");
  });
});

// ============================================================================
// R4.2 — calculateExpectedAvailabilityDate (integração)
// ============================================================================
describe("calculateExpectedAvailabilityDate", () => {
  it("Exemplo do documento: venda quarta, dias=[ter,sex], prazo=2 → terça", () => {
    const wed = new Date("2026-11-04T12:00:00"); // quarta
    const result = calculateExpectedAvailabilityDate([2, 5], 2, wed);
    expect(result).not.toBeNull();
    // Próximo dia de pedido: sexta 06/11
    expect(result!.orderDay).toBe("2026-11-06");
    // + 2 dias úteis = terça 10/11
    expect(result!.availabilityDate).toBe("2026-11-10");
  });

  it("venda na sexta após envio → próximo ciclo é terça", () => {
    const fri = new Date("2026-11-06T12:00:00"); // sexta
    const result = calculateExpectedAvailabilityDate([2, 5], 2, fri, true);
    expect(result).not.toBeNull();
    // afterCutoff=true → próximo é terça 10/11
    expect(result!.orderDay).toBe("2026-11-10");
    // + 2 dias úteis = quinta 12/11
    expect(result!.availabilityDate).toBe("2026-11-12");
  });
});

// ============================================================================
// R3.4 — calculatePackagePurchase
// ============================================================================
describe("calculatePackagePurchase", () => {
  it("3 un., caixa com 10 → compra 1 caixa, sobra 7", () => {
    const r = calculatePackagePurchase(3, 10);
    expect(r.packagesToBuy).toBe(1);
    expect(r.totalUnits).toBe(10);
    expect(r.leftover).toBe(7);
    expect(r.unitsFromStock).toBe(0);
  });

  it("12 un., caixa com 10 → compra 2 caixas, sobra 8", () => {
    const r = calculatePackagePurchase(12, 10);
    expect(r.packagesToBuy).toBe(2);
    expect(r.totalUnits).toBe(20);
    expect(r.leftover).toBe(8);
  });

  it("10 un., caixa com 10 → compra 1 caixa, sobra 0", () => {
    const r = calculatePackagePurchase(10, 10);
    expect(r.packagesToBuy).toBe(1);
    expect(r.totalUnits).toBe(10);
    expect(r.leftover).toBe(0);
  });

  it("5 un., avulso (qtd=1) → compra 5, sobra 0", () => {
    const r = calculatePackagePurchase(5, 1);
    expect(r.packagesToBuy).toBe(5);
    expect(r.totalUnits).toBe(5);
    expect(r.leftover).toBe(0);
  });

  it("5 un., caixa com 10, estoque existente 3 → compra 1 caixa para 2 un., sobra 8", () => {
    const r = calculatePackagePurchase(5, 10, 3);
    expect(r.unitsFromStock).toBe(3);
    expect(r.packagesToBuy).toBe(1);
    expect(r.totalUnits).toBe(10);
    expect(r.leftover).toBe(8);
  });

  it("2 un., caixa com 10, estoque existente 5 → sem compra", () => {
    const r = calculatePackagePurchase(2, 10, 5);
    expect(r.unitsFromStock).toBe(2);
    expect(r.packagesToBuy).toBe(0);
    expect(r.totalUnits).toBe(0);
    expect(r.leftover).toBe(0);
  });
});

// ============================================================================
// R5.3/R5.4/R5.5 — checkPriceChangeLimit
// ============================================================================
describe("checkPriceChangeLimit", () => {
  it("R5.3: aumento de 6,4% com limite 8% → permitido", () => {
    // Disjuntor R$ 24,90 → R$ 26,50
    const r = checkPriceChangeLimit(2490, 2650, 8);
    expect(r.allowed).toBe(true);
    expect(r.isReduction).toBe(false);
    expect(r.changePct).toBeCloseTo(6.43, 1);
  });

  it("R5.4: aumento de 13,8% com limite 8% → bloqueado", () => {
    // Ventilador R$ 289 → R$ 329
    const r = checkPriceChangeLimit(28900, 32900, 8);
    expect(r.allowed).toBe(false);
    expect(r.changePct).toBeCloseTo(13.84, 1);
  });

  it("aumento de exatamente 8% → permitido (borda)", () => {
    const r = checkPriceChangeLimit(10000, 10800, 8);
    expect(r.allowed).toBe(true);
    expect(r.changePct).toBeCloseTo(8.0, 1);
  });

  it("R5.5: redução sempre permitida", () => {
    const r = checkPriceChangeLimit(10000, 9000, 8);
    expect(r.allowed).toBe(true);
    expect(r.isReduction).toBe(true);
    expect(r.changePct).toBeCloseTo(-10, 1);
  });

  it("sem limite → sempre permitido", () => {
    const r = checkPriceChangeLimit(10000, 20000, null);
    expect(r.allowed).toBe(true);
  });
});

// ============================================================================
// R3.2 — calculateBoxPrice
// ============================================================================
describe("calculateBoxPrice", () => {
  it("Exemplo do documento: 10 un. × R$ 9,90, 10% off → R$ 89,10", () => {
    const r = calculateBoxPrice(990, 10, 10);
    expect(r).toBe(8910);
  });

  it("sem desconto → preço cheio", () => {
    const r = calculateBoxPrice(990, 10, 0);
    expect(r).toBe(9900);
  });

  it("100% desconto → 0", () => {
    const r = calculateBoxPrice(990, 10, 100);
    expect(r).toBe(0);
  });
});

// ============================================================================
// R2.2 — unit cost calculation
// ============================================================================
describe("unit cost calculation (R2.2)", () => {
  it("caixa com 10 a R$ 62,00 → custo por unidade R$ 6,20", () => {
    const packCost = 6200; // centavos
    const qty = 10;
    const unitCost = Math.round(packCost / qty);
    expect(unitCost).toBe(620);
  });

  it("unidade → custo = custo (qty=1)", () => {
    const packCost = 990;
    const qty = 1;
    const unitCost = Math.round(packCost / qty);
    expect(unitCost).toBe(990);
  });
});
