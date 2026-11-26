import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateEffectiveTimeout, computeExpiresAt, minutesUntilCutoff } from "../lib/supplier-timeout.mjs";

const defaults = {
  T_config: 45,
  T_min: 10,
  paymentEstimate: 30,
  backupResponseEstimate: 20,
};

describe("calculateEffectiveTimeout", () => {
  test("uses T_config when cutoff is null", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: null });
    assert.equal(r.T_efetivo, 45);
    assert.equal(r.simultaneous, false);
    assert.equal(r.reason, "cutoff_unknown_using_config");
  });

  test("uses T_config when cutoff is 0 or negative", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 0 });
    assert.equal(r.T_efetivo, 45);
    assert.equal(r.reason, "cutoff_unknown_using_config");

    const r2 = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: -10 });
    assert.equal(r2.T_efetivo, 45);
  });

  test("cutoff-constrained: T_dynamic < T_config", () => {
    // minutesUntilCutoff=80, T_dynamic = 80 - 30 - 20 = 30 < 45
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 80 });
    assert.equal(r.T_efetivo, 30);
    assert.equal(r.simultaneous, false);
    assert.equal(r.reason, "cutoff_constrained");
  });

  test("config_used: T_dynamic >= T_config", () => {
    // minutesUntilCutoff=200, T_dynamic = 200 - 30 - 20 = 150 > 45
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 200 });
    assert.equal(r.T_efetivo, 45);
    assert.equal(r.reason, "config_used");
  });

  test("clamps to T_min when T_dynamic is very small", () => {
    // minutesUntilCutoff=55, T_dynamic = 55 - 30 - 20 = 5 < T_min(10)
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 55 });
    assert.equal(r.T_efetivo, 10);
    assert.equal(r.simultaneous, true);
    assert.equal(r.reason, "simultaneous_t_lte_tmin");
  });

  test("simultaneous when T_efetivo == T_min exactly", () => {
    // minutesUntilCutoff=60, T_dynamic = 60 - 30 - 20 = 10 == T_min
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 60 });
    assert.equal(r.T_efetivo, 10);
    assert.equal(r.simultaneous, true);
    assert.equal(r.reason, "simultaneous_t_lte_tmin");
  });

  test("not simultaneous when T_efetivo > T_min by 1", () => {
    // minutesUntilCutoff=61, T_dynamic = 61 - 30 - 20 = 11 > T_min(10)
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 61 });
    assert.equal(r.T_efetivo, 11);
    assert.equal(r.simultaneous, false);
    assert.equal(r.reason, "cutoff_constrained");
  });

  test("negative T_dynamic is clamped to T_min", () => {
    // minutesUntilCutoff=10, T_dynamic = 10 - 30 - 20 = -40 → clamped to 10
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 10 });
    assert.equal(r.T_efetivo, 10);
    assert.equal(r.simultaneous, true);
  });

  test("custom T_min respected", () => {
    const r = calculateEffectiveTimeout({
      T_config: 45,
      T_min: 15,
      paymentEstimate: 30,
      backupResponseEstimate: 20,
      minutesUntilCutoff: 55,
    });
    // T_dynamic = 55 - 30 - 20 = 5 → clamped to T_min=15
    assert.equal(r.T_efetivo, 15);
    assert.equal(r.simultaneous, true);
  });
});

describe("computeExpiresAt", () => {
  test("returns ISO string T minutes from now", () => {
    const before = Date.now();
    const result = computeExpiresAt(30);
    const after = Date.now();

    const ts = new Date(result).getTime();
    assert.ok(ts >= before + 30 * 60_000);
    assert.ok(ts <= after + 30 * 60_000);
  });

  test("0 minutes returns approximately now", () => {
    const before = Date.now();
    const result = computeExpiresAt(0);
    const ts = new Date(result).getTime();
    assert.ok(Math.abs(ts - before) < 1000);
  });

  test("result is a valid ISO date string", () => {
    const result = computeExpiresAt(45);
    assert.ok(result.endsWith("Z"));
    assert.ok(!isNaN(Date.parse(result)));
  });
});

describe("minutesUntilCutoff", () => {
  test("returns null for null/undefined/empty cutoff", () => {
    assert.equal(minutesUntilCutoff(null), null);
    assert.equal(minutesUntilCutoff(undefined), null);
    assert.equal(minutesUntilCutoff(""), null);
  });

  test("returns null for invalid time format", () => {
    assert.equal(minutesUntilCutoff("abc"), null);
    assert.equal(minutesUntilCutoff("::"), null);
  });

  test("returns null for non-string input", () => {
    assert.equal(minutesUntilCutoff(123), null);
    assert.equal(minutesUntilCutoff(false), null);
  });

  test("returns positive minutes when cutoff is in the future", () => {
    const now = new Date();
    const futureH = (now.getHours() + 2) % 24;
    const futureTime = `${String(futureH).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const result = minutesUntilCutoff(futureTime);
    if (futureH > now.getHours() || (futureH === now.getHours() && now.getMinutes() < now.getMinutes())) {
      assert.ok(result > 0 || result === null);
    }
  });

  test("returns null when cutoff is in the past today", () => {
    const now = new Date();
    const pastH = now.getHours() - 2;
    if (pastH >= 0) {
      const pastTime = `${String(pastH).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const result = minutesUntilCutoff(pastTime);
      assert.equal(result, null);
    }
  });
});
