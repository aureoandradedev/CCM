import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rankProductOffers, rankAllProducts, extractWinnerBackup } from "../lib/ranking.mjs";

const base = { master_product_id: "mp1", status: "ativa" };

describe("rankProductOffers", () => {
  test("returns null for empty offers", () => {
    assert.equal(rankProductOffers([]), null);
  });

  test("returns no recommendation when all ineligible (status != ativa)", () => {
    const r = rankProductOffers([
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 100, stock: 10, lead_time_days: 1, status: "inativa" },
    ]);
    assert.equal(r.recommended_offer_id, null);
    assert.equal(r.offers.length, 0);
  });

  test("R6.1 picks lowest unit_cost with stock > 0", () => {
    const offers = [
      { ...base, id: "expensive", supplier_id: "s1", cost_centavos: 2000, unit_cost_centavos: 200, stock: 100, lead_time_days: 1 },
      { ...base, id: "cheap", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 7 },
      { ...base, id: "mid", supplier_id: "s3", cost_centavos: 1000, unit_cost_centavos: 100, stock: 50, lead_time_days: 3 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.recommended_offer_id, "cheap");
    assert.equal(r.ambiguous, false);
  });

  test("R6.1 skips offers with stock = 0", () => {
    const offers = [
      { ...base, id: "cheapest", supplier_id: "s1", cost_centavos: 100, unit_cost_centavos: 10, stock: 0, lead_time_days: 1 },
      { ...base, id: "available", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 20, lead_time_days: 3 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.recommended_offer_id, "available");
  });

  test("R6.1 marks ambiguous when top 2 have same unit_cost", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 20, lead_time_days: 2 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.recommended_offer_id, null);
    assert.equal(r.ambiguous, true);
  });

  test("R6.1 falls back to cost_centavos when unit_cost is null", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 300, unit_cost_centavos: null, stock: 10, lead_time_days: 3 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: null, stock: 10, lead_time_days: 3 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.recommended_offer_id, "a");
  });

  test("single offer with stock → recommended, not ambiguous", () => {
    const r = rankProductOffers([
      { ...base, id: "solo", supplier_id: "s1", cost_centavos: 1000, stock: 5, lead_time_days: 2 },
    ]);
    assert.equal(r.recommended_offer_id, "solo");
    assert.equal(r.ambiguous, false);
  });

  test("all offers zero stock → no recommendation", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 100, stock: 0, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 200, stock: null, lead_time_days: 2 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.recommended_offer_id, null);
    assert.equal(r.ambiguous, false);
  });

  test("scored offers get positions 1..N sorted by score descending", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 1000, stock: 100, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, stock: 50, lead_time_days: 2 },
      { ...base, id: "c", supplier_id: "s3", cost_centavos: 2000, stock: 10, lead_time_days: 5 },
    ];
    const r = rankProductOffers(offers);
    assert.equal(r.offers[0].position, 1);
    assert.equal(r.offers[1].position, 2);
    assert.equal(r.offers[2].position, 3);
    assert.ok(r.offers[0].score_total >= r.offers[1].score_total);
    assert.ok(r.offers[1].score_total >= r.offers[2].score_total);
  });

  test("flags out_of_stock for zero/null stock", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 100, stock: 0, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 200, stock: null, lead_time_days: 2 },
    ];
    const r = rankProductOffers(offers);
    assert.ok(r.offers[0].flags.includes("out_of_stock"));
    assert.ok(r.offers[1].flags.includes("out_of_stock"));
  });

  test("flags missing_cost for zero cost_centavos", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 0, stock: 10, lead_time_days: 1 },
    ];
    const r = rankProductOffers(offers);
    assert.ok(r.offers[0].flags.includes("missing_cost"));
  });
});

describe("rankAllProducts", () => {
  test("groups by master_product_id and ranks each", () => {
    const offers = [
      { id: "a1", master_product_id: "mp1", supplier_id: "s1", cost_centavos: 500, stock: 10, lead_time_days: 1, status: "ativa" },
      { id: "a2", master_product_id: "mp1", supplier_id: "s2", cost_centavos: 800, stock: 20, lead_time_days: 2, status: "ativa" },
      { id: "b1", master_product_id: "mp2", supplier_id: "s1", cost_centavos: 300, stock: 5, lead_time_days: 3, status: "ativa" },
    ];
    const results = rankAllProducts(offers);
    assert.equal(results.length, 2);
    const mp1 = results.find((r) => r.master_product_id === "mp1");
    const mp2 = results.find((r) => r.master_product_id === "mp2");
    assert.equal(mp1.recommended_offer_id, "a1");
    assert.equal(mp2.recommended_offer_id, "b1");
  });

  test("empty offers → empty results", () => {
    assert.deepEqual(rankAllProducts([]), []);
  });
});

describe("extractWinnerBackup", () => {
  test("returns winner and backup from ranked offers", () => {
    const offers = [
      { ...base, id: "w", supplier_id: "s1", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 800, unit_cost_centavos: 80, stock: 20, lead_time_days: 2 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s1");
    assert.equal(winner.offer_id, "w");
    assert.equal(backup.supplier_id, "s2");
    assert.equal(backup.offer_id, "b");
  });

  test("returns null winner/backup when ambiguous", () => {
    const offers = [
      { ...base, id: "a", supplier_id: "s1", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 1 },
      { ...base, id: "b", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 20, lead_time_days: 2 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner, null);
    assert.equal(backup, null);
  });

  test("returns winner but no backup for single offer", () => {
    const offers = [
      { ...base, id: "solo", supplier_id: "s1", cost_centavos: 300, stock: 5, lead_time_days: 2 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s1");
    assert.equal(backup, null);
  });

  test("returns null for null ranking", () => {
    const { winner, backup } = extractWinnerBackup(null, []);
    assert.equal(winner, null);
    assert.equal(backup, null);
  });

  test("skips offers without stock", () => {
    const offers = [
      { ...base, id: "nostock", supplier_id: "s1", cost_centavos: 100, unit_cost_centavos: 10, stock: 0, lead_time_days: 1 },
      { ...base, id: "hasstock", supplier_id: "s2", cost_centavos: 500, unit_cost_centavos: 50, stock: 10, lead_time_days: 3 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s2");
    assert.equal(backup, null);
  });

  test("skips inactive offers for winner/backup", () => {
    const offers = [
      { ...base, id: "inactive", supplier_id: "s1", cost_centavos: 100, stock: 50, lead_time_days: 1, status: "inativa" },
      { ...base, id: "active", supplier_id: "s2", cost_centavos: 500, stock: 10, lead_time_days: 3 },
    ];
    const ranking = rankProductOffers(offers);
    const { winner, backup } = extractWinnerBackup(ranking, offers);
    assert.equal(winner.supplier_id, "s2");
    assert.equal(backup, null);
  });
});
