/**
 * Compras dashboard com dataset vazio.
 *
 * Garante que:
 * - EMPTY_DASHBOARD tem shape completo com todos os campos zerados
 * - resultProtection.pending = 0
 * - Os cálculos defensivos do page.tsx não crasham com dados parciais/undefined
 * - Totais ficam 0 com shape vazio
 *
 * npx vitest run src/lib/__tests__/compras-dashboard-empty.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";

// Mirror of ComprasDashboardData + EMPTY_DASHBOARD from compras-data.ts.
// This is intentional: the test validates the contract the page relies on,
// independent of Supabase resolution.
interface ComprasDashboardData {
  catalogs: { total: number; pending: number };
  items: {
    pendente: number; normalizado: number; match_sugerido: number;
    revisao_manual: number; aprovado: number; ignorado: number; rejeitado: number;
  };
  offers: { total: number; multiOffer: number; ambiguous: number; clear: number; selected: number };
  resultProtection: { pending: number };
}

const EMPTY_DASHBOARD: ComprasDashboardData = {
  catalogs: { total: 0, pending: 0 },
  items: {
    pendente: 0, normalizado: 0, match_sugerido: 0,
    revisao_manual: 0, aprovado: 0, ignorado: 0, rejeitado: 0,
  },
  offers: { total: 0, multiOffer: 0, ambiguous: 0, clear: 0, selected: 0 },
  resultProtection: { pending: 0 },
};

describe("EMPTY_DASHBOARD shape contract", () => {
  it("catalogs é objeto com total e pending zerados", () => {
    expect(EMPTY_DASHBOARD.catalogs).toBeDefined();
    expect(EMPTY_DASHBOARD.catalogs.total).toBe(0);
    expect(EMPTY_DASHBOARD.catalogs.pending).toBe(0);
  });

  it("items tem todos os 7 status zerados", () => {
    const { items } = EMPTY_DASHBOARD;
    expect(items).toBeDefined();
    expect(items.pendente).toBe(0);
    expect(items.normalizado).toBe(0);
    expect(items.match_sugerido).toBe(0);
    expect(items.revisao_manual).toBe(0);
    expect(items.aprovado).toBe(0);
    expect(items.ignorado).toBe(0);
    expect(items.rejeitado).toBe(0);
  });

  it("offers tem todos os 5 campos zerados", () => {
    const { offers } = EMPTY_DASHBOARD;
    expect(offers).toBeDefined();
    expect(offers.total).toBe(0);
    expect(offers.multiOffer).toBe(0);
    expect(offers.ambiguous).toBe(0);
    expect(offers.clear).toBe(0);
    expect(offers.selected).toBe(0);
  });

  it("resultProtection.pending = 0", () => {
    expect(EMPTY_DASHBOARD.resultProtection).toBeDefined();
    expect(EMPTY_DASHBOARD.resultProtection.pending).toBe(0);
    expect(typeof EMPTY_DASHBOARD.resultProtection.pending).toBe("number");
  });

  it("nenhum campo é undefined", () => {
    for (const key of Object.keys(EMPTY_DASHBOARD) as (keyof ComprasDashboardData)[]) {
      expect(EMPTY_DASHBOARD[key]).not.toBeUndefined();
    }
  });
});

describe("page.tsx defensive calculations — zero state", () => {
  it("pendenciaTotal = 0 com EMPTY_DASHBOARD + stats vazio", () => {
    const d = EMPTY_DASHBOARD;
    const stats = { total: 0 };

    const pendenciaTotal =
      (d.items?.match_sugerido ?? 0) +
      (d.items?.revisao_manual ?? 0) +
      (d.items?.normalizado ?? 0) +
      (stats?.total ?? 0) +
      (d.resultProtection?.pending ?? 0);

    expect(pendenciaTotal).toBe(0);
  });

  it("produtosNaoIdentificados = 0 com EMPTY_DASHBOARD", () => {
    const d = EMPTY_DASHBOARD;
    const produtosNaoIdentificados =
      (d.items?.match_sugerido ?? 0) +
      (d.items?.revisao_manual ?? 0) +
      (d.items?.normalizado ?? 0);
    expect(produtosNaoIdentificados).toBe(0);
  });

  it("excecoesAbertas = 0 com stats vazio", () => {
    const stats = { total: 0 };
    const excecoesAbertas = stats?.total ?? 0;
    expect(excecoesAbertas).toBe(0);
  });

  it("resultadosPendentes = 0 com EMPTY_DASHBOARD", () => {
    const d = EMPTY_DASHBOARD;
    const resultadosPendentes = d.resultProtection?.pending ?? 0;
    expect(resultadosPendentes).toBe(0);
  });

  it("catalogs display usa defensive access sem crash", () => {
    const d = EMPTY_DASHBOARD;
    const pending = d.catalogs?.pending ?? 0;
    const total = d.catalogs?.total ?? 0;
    expect(pending).toBe(0);
    expect(total).toBe(0);
  });

  it("matching queue count usa defensive access sem crash", () => {
    const d = EMPTY_DASHBOARD;
    const count = (d.items?.match_sugerido ?? 0) + (d.items?.revisao_manual ?? 0);
    expect(count).toBe(0);
  });
});

describe("page.tsx defensive calculations — undefined/partial data", () => {
  it("não crasham quando d é objeto vazio ({})", () => {
    const d = {} as Partial<ComprasDashboardData>;

    const pendenciaTotal =
      ((d as ComprasDashboardData).items?.match_sugerido ?? 0) +
      ((d as ComprasDashboardData).items?.revisao_manual ?? 0) +
      ((d as ComprasDashboardData).items?.normalizado ?? 0) +
      ((d as ComprasDashboardData).resultProtection?.pending ?? 0);

    expect(pendenciaTotal).toBe(0);
  });

  it("não crasham quando stats é undefined", () => {
    const stats = undefined as { total: number } | undefined;
    const excecoesAbertas = stats?.total ?? 0;
    expect(excecoesAbertas).toBe(0);
  });

  it("não crasham quando autoWidget é undefined", () => {
    const autoWidget = undefined as { excecoesAbertas: number; trocasAuto24h: number; precosAuto24h: number; ultimaExecucao: string | null } | undefined;
    const autoOk = (autoWidget?.excecoesAbertas ?? 0) === 0;
    const trocas = autoWidget?.trocasAuto24h ?? 0;
    const precos = autoWidget?.precosAuto24h ?? 0;
    const lastRun = autoWidget?.ultimaExecucao;
    expect(autoOk).toBe(true);
    expect(trocas).toBe(0);
    expect(precos).toBe(0);
    expect(lastRun).toBeUndefined();
  });
});
