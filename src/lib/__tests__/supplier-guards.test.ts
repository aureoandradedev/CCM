/**
 * Testes dos guards operacionais de fornecedor (0020).
 *
 * Requer vitest: npx vitest run src/lib/__tests__/supplier-guards.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";
import { filterOperationalOffers } from "../admin/supplier-guards";
import type { RankableOffer } from "../ranking/types";

function offer(supplier_id: string, id = "off-1"): RankableOffer {
  return {
    id,
    master_product_id: "mp-1",
    supplier_id,
    cost_centavos: 10000,
    stock: 50,
    lead_time_days: 3,
    status: "ativa",
  };
}

describe("filterOperationalOffers", () => {
  it("mantém ofertas de fornecedores operacionais", () => {
    const ids = new Set(["s1", "s2"]);
    const offers = [offer("s1", "o1"), offer("s2", "o2")];
    expect(filterOperationalOffers(offers, ids)).toHaveLength(2);
  });

  it("remove ofertas de fornecedores não operacionais", () => {
    const ids = new Set(["s1"]);
    const offers = [offer("s1", "o1"), offer("s2", "o2"), offer("s3", "o3")];
    const result = filterOperationalOffers(offers, ids);
    expect(result).toHaveLength(1);
    expect(result[0].supplier_id).toBe("s1");
  });

  it("retorna vazio quando nenhum fornecedor é operacional", () => {
    const ids = new Set<string>();
    const offers = [offer("s1"), offer("s2")];
    expect(filterOperationalOffers(offers, ids)).toHaveLength(0);
  });

  it("retorna vazio quando não há ofertas", () => {
    const ids = new Set(["s1", "s2"]);
    expect(filterOperationalOffers([], ids)).toHaveLength(0);
  });

  it("preserva todos os campos da oferta filtrada", () => {
    const ids = new Set(["s1"]);
    const original = offer("s1");
    const [filtered] = filterOperationalOffers([original], ids);
    expect(filtered).toEqual(original);
  });
});

describe("ranking + operational guard integration", () => {
  it("ofertas pendente_condicoes não passam no filtro de status=ativa", () => {
    const pendingOffer: RankableOffer = {
      id: "o-pending",
      master_product_id: "mp-1",
      supplier_id: "s1",
      cost_centavos: 10000,
      stock: 50,
      lead_time_days: 3,
      status: "pendente_condicoes",
    };
    const ids = new Set(["s1"]);
    const result = filterOperationalOffers([pendingOffer], ids);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pendente_condicoes");
  });

  it("cenário realista: 3 suppliers, 1 não operacional, 1 com pendente_condicoes", () => {
    const ids = new Set(["s1", "s3"]);
    const offers: RankableOffer[] = [
      offer("s1", "o1"),
      offer("s2", "o2"),
      { ...offer("s3", "o3"), status: "pendente_condicoes" },
    ];

    const filtered = filterOperationalOffers(offers, ids);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((o) => o.id).sort()).toEqual(["o1", "o3"]);
  });
});
