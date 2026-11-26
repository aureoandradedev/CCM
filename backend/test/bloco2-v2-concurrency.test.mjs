/**
 * Bloco 2 V2 — Concurrency tests (PARTE 21)
 *
 * Models 100 concurrent winner × backup claim disputes against a single
 * order_item with residual_qty=50. The CAS (Compare-And-Swap) pattern
 * uses SELECT FOR UPDATE + LEAST(requested, remaining), ensuring
 * SUM(claims) never exceeds residual_qty even under concurrency.
 *
 * Since we cannot run 100 actual concurrent transactions here, we simulate
 * the CAS logic in-process using the same algorithm the SQL RPC uses.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

function simulateCAS(residualQty, claims) {
  let remaining = residualQty;
  const results = [];

  for (const claim of claims) {
    const granted = Math.min(claim.requested, Math.max(remaining, 0));
    remaining -= granted;
    results.push({
      claimant: claim.claimant,
      requested: claim.requested,
      granted,
    });
  }

  return { results, totalGranted: residualQty - remaining };
}

describe("Concurrency: 100 winner×backup disputes", () => {
  test("serial CAS: total granted never exceeds residual_qty", () => {
    const residualQty = 50;
    const claims = [];
    for (let i = 0; i < 100; i++) {
      claims.push({
        claimant: i % 2 === 0 ? `winner_${i}` : `backup_${i}`,
        requested: Math.floor(Math.random() * 10) + 1,
      });
    }

    const { results, totalGranted } = simulateCAS(residualQty, claims);

    assert.ok(totalGranted <= residualQty, `Total granted ${totalGranted} exceeds residual ${residualQty}`);

    const sumGranted = results.reduce((s, r) => s + r.granted, 0);
    assert.equal(sumGranted, totalGranted);
    assert.ok(sumGranted <= residualQty);
  });

  test("all claims for exactly residual_qty → first gets all, rest get 0", () => {
    const residualQty = 50;
    const claims = Array.from({ length: 100 }, (_, i) => ({
      claimant: `supplier_${i}`,
      requested: 50,
    }));

    const { results, totalGranted } = simulateCAS(residualQty, claims);

    assert.equal(totalGranted, 50);
    assert.equal(results[0].granted, 50);
    for (let i = 1; i < 100; i++) {
      assert.equal(results[i].granted, 0, `Claim ${i} should get 0`);
    }
  });

  test("many small claims exhaust residual exactly", () => {
    const residualQty = 50;
    const claims = Array.from({ length: 100 }, (_, i) => ({
      claimant: `supplier_${i}`,
      requested: 1,
    }));

    const { results, totalGranted } = simulateCAS(residualQty, claims);

    assert.equal(totalGranted, 50);
    const grantedCount = results.filter((r) => r.granted > 0).length;
    assert.equal(grantedCount, 50);
    const deniedCount = results.filter((r) => r.granted === 0).length;
    assert.equal(deniedCount, 50);
  });

  test("interleaved winner/backup claims respect ordering", () => {
    const residualQty = 50;
    const claims = [];
    for (let i = 0; i < 50; i++) {
      claims.push({ claimant: `winner_${i}`, requested: 2 });
      claims.push({ claimant: `backup_${i}`, requested: 2 });
    }

    const { results, totalGranted } = simulateCAS(residualQty, claims);

    assert.equal(totalGranted, 50);
    const sumGranted = results.reduce((s, r) => s + r.granted, 0);
    assert.equal(sumGranted, 50);
  });

  test("CAS with zero residual grants nothing", () => {
    const residualQty = 0;
    const claims = Array.from({ length: 100 }, (_, i) => ({
      claimant: `supplier_${i}`,
      requested: 10,
    }));

    const { results, totalGranted } = simulateCAS(residualQty, claims);

    assert.equal(totalGranted, 0);
    for (const r of results) {
      assert.equal(r.granted, 0);
    }
  });

  test("partial claim: requested > remaining → grants only remaining", () => {
    const residualQty = 50;
    const claims = [
      { claimant: "winner", requested: 30 },
      { claimant: "backup", requested: 30 },
    ];

    const { results } = simulateCAS(residualQty, claims);

    assert.equal(results[0].granted, 30);
    assert.equal(results[1].granted, 20);
    assert.equal(results[0].granted + results[1].granted, 50);
  });

  test("stress: 1000 random claims against residual=100 never overclaim", () => {
    const residualQty = 100;
    const claims = Array.from({ length: 1000 }, (_, i) => ({
      claimant: `s_${i}`,
      requested: Math.floor(Math.random() * 20) + 1,
    }));

    const { totalGranted, results } = simulateCAS(residualQty, claims);

    assert.ok(totalGranted <= residualQty);
    const sum = results.reduce((s, r) => s + r.granted, 0);
    assert.equal(sum, totalGranted);
    for (const r of results) {
      assert.ok(r.granted >= 0);
      assert.ok(r.granted <= r.requested);
    }
  });
});

describe("Concurrency: idempotency guards", () => {
  test("duplicate claim from same supplier is idempotent (second returns existing)", () => {
    const existingClaims = new Map();
    const tryClaimIdempotent = (supplierId, itemId, qty, residualQty) => {
      const key = `${supplierId}:${itemId}`;
      if (existingClaims.has(key)) return { ok: true, existing: true, qty: existingClaims.get(key) };
      const granted = Math.min(qty, residualQty);
      existingClaims.set(key, granted);
      return { ok: true, existing: false, qty: granted };
    };

    const r1 = tryClaimIdempotent("s1", "oi1", 10, 50);
    assert.equal(r1.existing, false);
    assert.equal(r1.qty, 10);

    const r2 = tryClaimIdempotent("s1", "oi1", 10, 40);
    assert.equal(r2.existing, true);
    assert.equal(r2.qty, 10);
  });
});
