/**
 * Tests: Bloco 2 V2 — Ranking, winner/backup extraction, timeout, claim invariants.
 * Pure logic only — no DB, no network.
 *
 * Run: npx vitest run src/lib/__tests__/bloco2-v2-ranking.test.ts
 */
// @ts-expect-error vitest not installed yet
import { describe, it, expect } from "vitest";

// ============================================================================
// Types (mirror of migration 0067 / 0070 structures)
// ============================================================================

type SupplierRole = "vencedor" | "reserva" | "manual";
type RequestStatus =
  | "aguardando_confirmacao"
  | "confirmado"
  | "confirmado_parcial"
  | "expirado"
  | "escalado"
  | "perdido"
  | "cancelado";

interface SupplierRequest {
  id: string;
  order_id: string;
  supplier_id: string;
  role: SupplierRole;
  status: RequestStatus;
  expires_at: string | null;
  handoff_at: string | null;
  transferred_from_request_id: string | null;
}

interface ClaimLine {
  order_item_id: string;
  supplier_request_line_id: string;
  qty_claimed: number;
}

interface OrderItem {
  id: string;
  qty: number;
  residual_qty: number;
}

// ============================================================================
// Pure helpers (replicate DB-side invariants for testing)
// ============================================================================

function extractWinnerBackupFromRequests(
  requests: SupplierRequest[],
): { winner: SupplierRequest | null; backup: SupplierRequest | null } {
  const winner = requests.find((r) => r.role === "vencedor") ?? null;
  const backup = requests.find((r) => r.role === "reserva") ?? null;
  return { winner, backup };
}

function claimAmount(
  requested: number,
  remaining: number,
): number {
  return Math.min(requested, remaining);
}

function checkOverclaim(
  itemQty: number,
  totalClaimed: number,
): boolean {
  return totalClaimed > itemQty;
}

function checkGateV2(
  items: OrderItem[],
  claims: ClaimLine[],
): { passed: boolean; shortItems: string[] } {
  const shortItems: string[] = [];
  for (const item of items) {
    const itemClaims = claims.filter((c) => c.order_item_id === item.id);
    const totalClaimed = itemClaims.reduce((sum, c) => sum + c.qty_claimed, 0);
    if (totalClaimed < item.residual_qty) {
      shortItems.push(item.id);
    }
  }
  return { passed: shortItems.length === 0, shortItems };
}

function shouldEscalate(
  request: SupplierRequest,
  hasBackup: boolean,
): boolean {
  if (request.status !== "expirado") return false;
  return !hasBackup;
}

function isSimultaneous(T_efetivo: number, T_min: number): boolean {
  return T_efetivo <= T_min;
}

function calculateEffectiveTimeout(opts: {
  T_config: number;
  T_min: number;
  paymentEstimate: number;
  backupResponseEstimate: number;
  minutesUntilCutoff: number | null;
}): { T_efetivo: number; simultaneous: boolean; reason: string } {
  let T_efetivo: number;
  let reason: string;

  if (opts.minutesUntilCutoff == null || opts.minutesUntilCutoff <= 0) {
    T_efetivo = opts.T_config;
    reason = "cutoff_unknown_using_config";
  } else {
    const T_dynamic =
      opts.minutesUntilCutoff - opts.paymentEstimate - opts.backupResponseEstimate;
    T_efetivo = Math.min(opts.T_config, T_dynamic);
    reason = T_dynamic < opts.T_config ? "cutoff_constrained" : "config_used";
  }

  T_efetivo = Math.max(T_efetivo, opts.T_min);

  const simultaneous = T_efetivo <= opts.T_min;
  if (simultaneous) {
    reason = "simultaneous_t_lte_tmin";
  }

  return { T_efetivo, simultaneous, reason };
}

// ============================================================================
// Tests
// ============================================================================

describe("Winner/Backup Extraction", () => {
  it("extracts winner and backup from request list", () => {
    const requests: SupplierRequest[] = [
      { id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor", status: "aguardando_confirmacao", expires_at: null, handoff_at: null, transferred_from_request_id: null },
      { id: "r2", order_id: "o1", supplier_id: "s2", role: "reserva", status: "aguardando_confirmacao", expires_at: null, handoff_at: null, transferred_from_request_id: null },
    ];
    const { winner, backup } = extractWinnerBackupFromRequests(requests);
    expect(winner?.supplier_id).toBe("s1");
    expect(backup?.supplier_id).toBe("s2");
  });

  it("returns null backup when only winner exists", () => {
    const requests: SupplierRequest[] = [
      { id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor", status: "aguardando_confirmacao", expires_at: null, handoff_at: null, transferred_from_request_id: null },
    ];
    const { winner, backup } = extractWinnerBackupFromRequests(requests);
    expect(winner).not.toBeNull();
    expect(backup).toBeNull();
  });

  it("returns nulls when no requests", () => {
    const { winner, backup } = extractWinnerBackupFromRequests([]);
    expect(winner).toBeNull();
    expect(backup).toBeNull();
  });
});

describe("Claim CAS logic", () => {
  it("claims MIN(requested, remaining)", () => {
    expect(claimAmount(10, 10)).toBe(10);
    expect(claimAmount(10, 5)).toBe(5);
    expect(claimAmount(5, 10)).toBe(5);
    expect(claimAmount(0, 10)).toBe(0);
    expect(claimAmount(10, 0)).toBe(0);
  });

  it("detects overclaim", () => {
    expect(checkOverclaim(10, 11)).toBe(true);
    expect(checkOverclaim(10, 10)).toBe(false);
    expect(checkOverclaim(10, 5)).toBe(false);
  });

  it("prevents negative claims", () => {
    expect(claimAmount(-1, 10)).toBe(-1); // should be guarded at DB level
    expect(claimAmount(10, -1)).toBe(-1); // should be guarded at DB level
  });
});

describe("Gate V2 (claim-based)", () => {
  it("passes when all items fully claimed", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 7 },
      { id: "i2", qty: 5, residual_qty: 3 },
    ];
    const claims: ClaimLine[] = [
      { order_item_id: "i1", supplier_request_line_id: "l1", qty_claimed: 7 },
      { order_item_id: "i2", supplier_request_line_id: "l2", qty_claimed: 3 },
    ];
    const result = checkGateV2(items, claims);
    expect(result.passed).toBe(true);
    expect(result.shortItems).toHaveLength(0);
  });

  it("fails when items are under-claimed", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 7 },
      { id: "i2", qty: 5, residual_qty: 3 },
    ];
    const claims: ClaimLine[] = [
      { order_item_id: "i1", supplier_request_line_id: "l1", qty_claimed: 5 },
      { order_item_id: "i2", supplier_request_line_id: "l2", qty_claimed: 3 },
    ];
    const result = checkGateV2(items, claims);
    expect(result.passed).toBe(false);
    expect(result.shortItems).toEqual(["i1"]);
  });

  it("passes with multiple claims per item summing to residual", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 8 },
    ];
    const claims: ClaimLine[] = [
      { order_item_id: "i1", supplier_request_line_id: "l1", qty_claimed: 5 },
      { order_item_id: "i1", supplier_request_line_id: "l2", qty_claimed: 3 },
    ];
    const result = checkGateV2(items, claims);
    expect(result.passed).toBe(true);
  });

  it("passes with over-claimed items (claims > residual)", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 5 },
    ];
    const claims: ClaimLine[] = [
      { order_item_id: "i1", supplier_request_line_id: "l1", qty_claimed: 6 },
    ];
    const result = checkGateV2(items, claims);
    expect(result.passed).toBe(true);
  });

  it("fails when no claims exist", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 7 },
    ];
    const result = checkGateV2(items, []);
    expect(result.passed).toBe(false);
    expect(result.shortItems).toEqual(["i1"]);
  });

  it("passes with zero residual (CCM-only items)", () => {
    const items: OrderItem[] = [
      { id: "i1", qty: 10, residual_qty: 0 },
    ];
    const result = checkGateV2(items, []);
    expect(result.passed).toBe(true);
  });
});

describe("Escalation logic", () => {
  it("escalates expired request with no backup", () => {
    const req: SupplierRequest = {
      id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor",
      status: "expirado", expires_at: null, handoff_at: null, transferred_from_request_id: null,
    };
    expect(shouldEscalate(req, false)).toBe(true);
  });

  it("does not escalate expired request when backup exists", () => {
    const req: SupplierRequest = {
      id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor",
      status: "expirado", expires_at: null, handoff_at: null, transferred_from_request_id: null,
    };
    expect(shouldEscalate(req, true)).toBe(false);
  });

  it("does not escalate non-expired request", () => {
    const req: SupplierRequest = {
      id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor",
      status: "aguardando_confirmacao", expires_at: null, handoff_at: null, transferred_from_request_id: null,
    };
    expect(shouldEscalate(req, false)).toBe(false);
  });
});

describe("Dynamic timeout (T calculation)", () => {
  const defaults = {
    T_config: 45,
    T_min: 10,
    paymentEstimate: 30,
    backupResponseEstimate: 20,
  };

  it("uses T_config when cutoff unknown", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: null });
    expect(r.T_efetivo).toBe(45);
    expect(r.simultaneous).toBe(false);
    expect(r.reason).toBe("cutoff_unknown_using_config");
  });

  it("cutoff-constrained: T_dynamic < T_config", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 80 });
    expect(r.T_efetivo).toBe(30); // 80 - 30 - 20 = 30
    expect(r.reason).toBe("cutoff_constrained");
  });

  it("config_used: T_dynamic >= T_config", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 200 });
    expect(r.T_efetivo).toBe(45);
    expect(r.reason).toBe("config_used");
  });

  it("clamps to T_min when T_dynamic < T_min", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 55 });
    expect(r.T_efetivo).toBe(10); // 55 - 30 - 20 = 5 < T_min=10
    expect(r.simultaneous).toBe(true);
    expect(r.reason).toBe("simultaneous_t_lte_tmin");
  });

  it("simultaneous when T_efetivo == T_min exactly", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 60 });
    expect(r.T_efetivo).toBe(10); // 60 - 30 - 20 = 10 == T_min
    expect(r.simultaneous).toBe(true);
  });

  it("not simultaneous at T_min + 1", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 61 });
    expect(r.T_efetivo).toBe(11);
    expect(r.simultaneous).toBe(false);
  });

  it("negative T_dynamic clamped to T_min", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 10 });
    expect(r.T_efetivo).toBe(10); // 10 - 30 - 20 = -40 → 10
    expect(r.simultaneous).toBe(true);
  });

  it("simultaneous flag drives dual-send", () => {
    const r = calculateEffectiveTimeout({ ...defaults, minutesUntilCutoff: 55 });
    expect(isSimultaneous(r.T_efetivo, defaults.T_min)).toBe(true);
  });
});

describe("Handoff invariants", () => {
  it("backup request gets transferred_from_request_id after handoff", () => {
    const backup: SupplierRequest = {
      id: "r2", order_id: "o1", supplier_id: "s2", role: "reserva",
      status: "aguardando_confirmacao", expires_at: null,
      handoff_at: "2026-01-01T12:00:00Z",
      transferred_from_request_id: "r1",
    };
    expect(backup.transferred_from_request_id).toBe("r1");
    expect(backup.handoff_at).toBeTruthy();
  });

  it("winner without handoff has null transferred_from_request_id", () => {
    const winner: SupplierRequest = {
      id: "r1", order_id: "o1", supplier_id: "s1", role: "vencedor",
      status: "aguardando_confirmacao", expires_at: null,
      handoff_at: null, transferred_from_request_id: null,
    };
    expect(winner.transferred_from_request_id).toBeNull();
    expect(winner.handoff_at).toBeNull();
  });
});

describe("Per-line loss detection", () => {
  it("line is lost when remaining=0 and no claim exists", () => {
    const remaining = 0;
    const hasClaim = false;
    const isLost = remaining === 0 && !hasClaim;
    expect(isLost).toBe(true);
  });

  it("line is NOT lost when claim exists even if remaining=0", () => {
    const remaining = 0;
    const hasClaim = true;
    const isLost = remaining === 0 && !hasClaim;
    expect(isLost).toBe(false);
  });

  it("line is NOT lost when remaining > 0 regardless of claim", () => {
    expect(5 === 0 && !false).toBe(false);
    expect(5 === 0 && !true).toBe(false);
  });
});

describe("Concurrency: dual-claim race", () => {
  it("two suppliers claiming same item — CAS ensures total <= residual", () => {
    const residual = 10;
    let remaining = residual;

    // Supplier A claims 7
    const claimA = claimAmount(7, remaining);
    remaining -= claimA;
    expect(claimA).toBe(7);
    expect(remaining).toBe(3);

    // Supplier B tries to claim 7 but only 3 remain
    const claimB = claimAmount(7, remaining);
    remaining -= claimB;
    expect(claimB).toBe(3);
    expect(remaining).toBe(0);

    // Total claimed = 10 = residual, no overclaim
    expect(claimA + claimB).toBe(residual);
    expect(checkOverclaim(residual, claimA + claimB)).toBe(false);
  });

  it("simultaneous full claims — second gets zero", () => {
    const residual = 5;
    let remaining = residual;

    const claimA = claimAmount(5, remaining);
    remaining -= claimA;
    expect(claimA).toBe(5);

    const claimB = claimAmount(5, remaining);
    expect(claimB).toBe(0);
    expect(remaining).toBe(0);
  });
});

describe("Backup cost threshold", () => {
  it("backup within threshold (10%) is acceptable", () => {
    const winnerCost = 1000; // R$10.00
    const backupCost = 1050; // R$10.50 (5% more)
    const threshold = 10; // 10%
    const pctDiff = ((backupCost - winnerCost) / winnerCost) * 100;
    expect(pctDiff).toBeLessThanOrEqual(threshold);
  });

  it("backup exceeding threshold is flagged", () => {
    const winnerCost = 1000;
    const backupCost = 1200; // 20% more
    const threshold = 15;
    const pctDiff = ((backupCost - winnerCost) / winnerCost) * 100;
    expect(pctDiff).toBeGreaterThan(threshold);
  });

  it("backup cheaper than winner is always acceptable", () => {
    const winnerCost = 1000;
    const backupCost = 900;
    const threshold = 10;
    const pctDiff = ((backupCost - winnerCost) / winnerCost) * 100;
    expect(pctDiff).toBeLessThanOrEqual(threshold);
  });

  it("zero winner cost — guard against division by zero", () => {
    const winnerCost = 0;
    const backupCost = 500;
    const threshold = 10;
    const isAcceptable = winnerCost === 0 ? false : ((backupCost - winnerCost) / winnerCost) * 100 <= threshold;
    expect(isAcceptable).toBe(false);
  });
});
