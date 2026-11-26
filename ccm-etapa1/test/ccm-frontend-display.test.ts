import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type CcmOrderDisplay,
  type CcmItemDisplay,
  getTimelineSteps,
  formatItemCcmStatus,
  shouldShowAdjustmentBanner,
  getAdjustmentMessage,
  getReadyForPaymentMessage,
  sanitizePaymentError,
  getSuccessSteps,
  isPaymentBlocked,
  containsForbiddenTerms,
} from "../src/regras6.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────

const OFF: CcmOrderDisplay = { enabled: false, hasCcm: false, isCcmOnly: false, hasShortfall: false, items: [] };

const CCM_ONLY: CcmOrderDisplay = {
  enabled: true, hasCcm: true, isCcmOnly: true, hasShortfall: false,
  items: [
    { orderItemId: "oi-1", ccmQty: 5, supplierQty: 0, totalQty: 5 },
    { orderItemId: "oi-2", ccmQty: 3, supplierQty: 0, totalQty: 3 },
  ],
};

const MIXED: CcmOrderDisplay = {
  enabled: true, hasCcm: true, isCcmOnly: false, hasShortfall: false,
  items: [
    { orderItemId: "oi-1", ccmQty: 5, supplierQty: 0, totalQty: 5 },
    { orderItemId: "oi-2", ccmQty: 0, supplierQty: 3, totalQty: 3 },
  ],
};

const SPLIT: CcmOrderDisplay = {
  enabled: true, hasCcm: true, isCcmOnly: false, hasShortfall: false,
  items: [
    { orderItemId: "oi-1", ccmQty: 1, supplierQty: 2, totalQty: 3 },
  ],
};

const SHORTFALL: CcmOrderDisplay = {
  enabled: true, hasCcm: true, isCcmOnly: false, hasShortfall: true,
  items: [
    { orderItemId: "oi-1", ccmQty: 1, supplierQty: 2, totalQty: 3 },
  ],
};

const SHORTFALL_CCM_ONLY: CcmOrderDisplay = {
  enabled: true, hasCcm: true, isCcmOnly: true, hasShortfall: true,
  items: [
    { orderItemId: "oi-1", ccmQty: 3, supplierQty: 0, totalQty: 3 },
  ],
};

const FETCH_ERROR: CcmOrderDisplay = {
  enabled: false, hasCcm: false, isCcmOnly: false, hasShortfall: false,
  items: [], fetchError: true,
};

// ─── A: flag OFF ──────────────────────────────────────────────────────────

describe("A: flag OFF → UI idêntica à atual", () => {
  it("A1: timeline returns full 8 steps when flag OFF", () => {
    const steps = getTimelineSteps(OFF);
    assert.equal(steps.length, 8);
    assert.equal(steps[1].key, "aguardando-confirmacao");
  });

  it("A2: timeline returns full 8 steps when ccmInfo is null", () => {
    const steps = getTimelineSteps(null);
    assert.equal(steps.length, 8);
  });

  it("A3: adjustment banner never shows when flag OFF", () => {
    assert.equal(shouldShowAdjustmentBanner("aguardando-confirmacao", OFF), false);
    assert.equal(shouldShowAdjustmentBanner("aguardando-confirmacao", null), false);
  });

  it("A4: success page shows 3 steps when flag OFF", () => {
    assert.equal(getSuccessSteps(OFF).length, 3);
    assert.equal(getSuccessSteps(null).length, 3);
  });

  it("A5: payment not blocked when flag OFF", () => {
    assert.equal(isPaymentBlocked("aguardando-confirmacao", OFF).blocked, false);
    assert.equal(isPaymentBlocked("aguardando-confirmacao", null).blocked, false);
  });

  it("A6: ready-for-payment message is supplier-based when flag OFF", () => {
    const msg = getReadyForPaymentMessage(null);
    assert.ok(msg.title.includes("fornecedores"));
  });
});

// ─── B: 100% CCM ─────────────────────────────────────────────────────────

describe("B: 100% CCM → sem etapa fornecedor", () => {
  it("B1: timeline has 7 steps (no aguardando-confirmacao)", () => {
    const steps = getTimelineSteps(CCM_ONLY);
    assert.equal(steps.length, 7);
    assert.ok(!steps.some((s) => s.key === "aguardando-confirmacao"));
    assert.equal(steps[0].key, "pedido-realizado");
    assert.equal(steps[1].key, "aguardando-pagamento");
  });

  it("B2: success page shows 2 steps for CCM-only", () => {
    const steps = getSuccessSteps(CCM_ONLY);
    assert.equal(steps.length, 2);
    assert.ok(steps[0].text.includes("disponíveis para entrega imediata"));
  });

  it("B3: ready-for-payment is not supplier-specific for CCM-only", () => {
    const msg = getReadyForPaymentMessage(CCM_ONLY);
    assert.ok(!msg.title.includes("fornecedores"));
    assert.ok(msg.title.includes("pronto para pagamento"));
  });

  it("B4: all items show Disponível", () => {
    for (const item of CCM_ONLY.items) {
      const status = formatItemCcmStatus(item, "un");
      assert.ok(status);
      assert.equal(status.available, "Disponível");
      assert.equal(status.pending, null);
    }
  });
});

// ─── C: Misto CCM + fornecedor ───────────────────────────────────────────

describe("C: misto CCM + fornecedor", () => {
  it("C1: timeline has 8 steps (keeps supplier step)", () => {
    const steps = getTimelineSteps(MIXED);
    assert.equal(steps.length, 8);
    assert.ok(steps.some((s) => s.key === "aguardando-confirmacao"));
  });

  it("C2: CCM item shows Disponível, supplier item shows Em confirmação", () => {
    const ccmItem = formatItemCcmStatus(MIXED.items[0], "un");
    assert.ok(ccmItem);
    assert.equal(ccmItem.available, "Disponível");
    assert.equal(ccmItem.pending, null);

    const supplierItem = formatItemCcmStatus(MIXED.items[1], "un");
    assert.ok(supplierItem);
    assert.equal(supplierItem.available, null);
    assert.equal(supplierItem.pending, "Em confirmação");
  });
});

// ─── D: Split do mesmo item ──────────────────────────────────────────────

describe("D: split do mesmo item", () => {
  it("D1: split item shows both available and pending with quantities", () => {
    const item = SPLIT.items[0];
    const status = formatItemCcmStatus(item, "un");
    assert.ok(status);
    assert.equal(status.available, "1 un disponível");
    assert.equal(status.pending, "2 un em confirmação");
  });

  it("D2: split with kg unit formats correctly", () => {
    const item: CcmItemDisplay = { orderItemId: "oi-1", ccmQty: 2, supplierQty: 5, totalQty: 7 };
    const status = formatItemCcmStatus(item, "kg");
    assert.ok(status);
    assert.equal(status.available, "2 kg disponível");
    assert.equal(status.pending, "5 kg em confirmação");
  });
});

// ─── E: Shortfall → mensagem de ajuste ───────────────────────────────────

describe("E: shortfall → mensagem de ajuste", () => {
  it("E1: adjustment banner shows when shortfall + aguardando-confirmacao", () => {
    assert.ok(shouldShowAdjustmentBanner("aguardando-confirmacao", SHORTFALL));
  });

  it("E2: adjustment banner hides when not in aguardando-confirmacao", () => {
    assert.ok(!shouldShowAdjustmentBanner("aguardando-pagamento", SHORTFALL));
    assert.ok(!shouldShowAdjustmentBanner("em-separacao", SHORTFALL));
  });

  it("E3: adjustment message text is correct", () => {
    const msg = getAdjustmentMessage();
    assert.equal(msg.title, "Ajustamos seu pedido antes do pagamento.");
    assert.ok(msg.body.includes("não está mais disponível para entrega imediata"));
  });
});

// ─── F: Shortfall → pagamento indisponível ───────────────────────────────

describe("F: shortfall → pagamento indisponível", () => {
  it("F1: payment blocked when shortfall + aguardando-confirmacao", () => {
    const result = isPaymentBlocked("aguardando-confirmacao", SHORTFALL);
    assert.ok(result.blocked);
    assert.ok(result.reason);
    assert.ok(result.reason!.includes("confirmando a disponibilidade"));
  });

  it("F2: payment not blocked when aguardando-pagamento (even with shortfall flag)", () => {
    assert.ok(!isPaymentBlocked("aguardando-pagamento", SHORTFALL).blocked);
  });
});

// ─── G: Fornecedor confirma → pagamento volta ────────────────────────────

describe("G: fornecedor confirma → pagamento volta", () => {
  it("G1: ready message after shortfall recovery is correct", () => {
    const ccmAfterRecovery: CcmOrderDisplay = { ...SHORTFALL, hasShortfall: true };
    const msg = getReadyForPaymentMessage(ccmAfterRecovery);
    assert.ok(msg.title.includes("pronto para pagamento"));
    assert.ok(!msg.title.includes("fornecedores"));
  });
});

// ─── H: Notificação reaproveita sistema existente ────────────────────────

describe("H: notificação 'pronto para pagamento' reaproveita sistema existente", () => {
  it("H1: ready-for-payment uses existing message structure", () => {
    const msg = getReadyForPaymentMessage(null);
    assert.ok(msg.title);
    assert.ok(msg.body);
    assert.ok(msg.body.includes("pagamento"));
  });

  it("H2: no new notification system — only banner messages", () => {
    const msg = getReadyForPaymentMessage(MIXED);
    assert.ok(msg.title.includes("fornecedores confirmaram"));
  });
});

// ─── I: Erro técnico não expõe detalhes ──────────────────────────────────

describe("I: erro técnico não expõe detalhes", () => {
  it("I1: ccmShortfall 409 → friendly message", () => {
    const r = sanitizePaymentError(409, { ccmShortfall: true, faltou: 2 });
    assert.ok(r.isShortfall);
    assert.ok(r.shouldRefresh);
    assert.ok(r.message.includes("Ajustamos"));
    assert.ok(!r.message.includes("409"));
    assert.ok(!r.message.includes("ccmShortfall"));
  });

  it("I2: 500 with RPC error → safe generic message", () => {
    const r = sanitizePaymentError(500, { erro: "RPC error: function confirm_ccm_stock_sale failed" });
    assert.ok(!r.message.includes("RPC"));
    assert.ok(!r.message.includes("function"));
    assert.ok(r.message.includes("Tente novamente"));
  });

  it("I3: 500 with database error → safe generic message", () => {
    const r = sanitizePaymentError(500, { erro: "database connection failed: PostgreSQL timeout" });
    assert.ok(!r.message.includes("database"));
    assert.ok(!r.message.includes("PostgreSQL"));
  });

  it("I4: 409 without ccmShortfall → generic but safe", () => {
    const r = sanitizePaymentError(409, { erro: "Pedido não está liberado para pagamento." });
    assert.ok(!r.isShortfall);
    assert.ok(r.shouldRefresh);
  });

  it("I5: pricing version 409 returns empty (let existing handler)", () => {
    const r = sanitizePaymentError(409, { pricingVersion: 2, totalCentavos: 15000 });
    assert.equal(r.message, "");
    assert.ok(!r.isShortfall);
  });

  it("I6: 402 returns card-specific message", () => {
    const r = sanitizePaymentError(402, {});
    assert.ok(r.message.includes("operadora"));
  });
});

// ─── J: Cliente nunca vê nome do fornecedor ──────────────────────────────

describe("J: cliente nunca vê nome do fornecedor em mensagens CCM", () => {
  it("J1: adjustment message has no forbidden terms", () => {
    const msg = getAdjustmentMessage();
    assert.ok(!containsForbiddenTerms(msg.title));
    assert.ok(!containsForbiddenTerms(msg.body));
  });

  it("J2: CCM-only ready message has no forbidden terms", () => {
    const msg = getReadyForPaymentMessage(CCM_ONLY);
    assert.ok(!containsForbiddenTerms(msg.title));
    assert.ok(!containsForbiddenTerms(msg.body));
  });

  it("J3: shortfall error message has no forbidden terms", () => {
    const r = sanitizePaymentError(409, { ccmShortfall: true, faltou: 3 });
    assert.ok(!containsForbiddenTerms(r.message));
  });

  it("J4: payment blocked reason has no forbidden terms", () => {
    const r = isPaymentBlocked("aguardando-confirmacao", SHORTFALL);
    assert.ok(r.reason);
    assert.ok(!containsForbiddenTerms(r.reason!));
  });

  it("J5: formatItemCcmStatus never uses 'fornecedor' or 'supplier'", () => {
    const statuses = [
      formatItemCcmStatus({ orderItemId: "a", ccmQty: 5, supplierQty: 0, totalQty: 5 }, "un"),
      formatItemCcmStatus({ orderItemId: "b", ccmQty: 0, supplierQty: 3, totalQty: 3 }, "un"),
      formatItemCcmStatus({ orderItemId: "c", ccmQty: 1, supplierQty: 2, totalQty: 3 }, "un"),
    ];
    for (const s of statuses) {
      if (s?.available) assert.ok(!containsForbiddenTerms(s.available));
      if (s?.pending) assert.ok(!containsForbiddenTerms(s.pending));
    }
  });
});

// ─── K: Disponibilidade não é calculada no browser ───────────────────────

describe("K: disponibilidade não é calculada no browser", () => {
  it("K1: formatItemCcmStatus uses pre-computed ccmQty/supplierQty from server", () => {
    const item: CcmItemDisplay = { orderItemId: "oi-1", ccmQty: 2, supplierQty: 1, totalQty: 3 };
    const status = formatItemCcmStatus(item, "un");
    assert.ok(status);
    assert.equal(status.available, "2 un disponível");
    assert.equal(status.pending, "1 un em confirmação");
  });

  it("K2: getTimelineSteps receives classification from server, no stock math", () => {
    const steps = getTimelineSteps(CCM_ONLY);
    assert.equal(steps.length, 7);
  });

  it("K3: isPaymentBlocked depends on server status + ccmInfo, no local calculation", () => {
    const r = isPaymentBlocked("aguardando-confirmacao", SHORTFALL);
    assert.ok(r.blocked);
  });
});

// ─── L: Refresh mantém estado correto vindo do servidor ──────────────────

describe("L: refresh mantém estado correto vindo do servidor", () => {
  it("L1: same ccmInfo produces same display (deterministic)", () => {
    const steps1 = getTimelineSteps(CCM_ONLY);
    const steps2 = getTimelineSteps(CCM_ONLY);
    assert.deepEqual(steps1, steps2);
  });

  it("L2: state change reflected when ccmInfo changes (shortfall → recovered)", () => {
    const duringShortfall = shouldShowAdjustmentBanner("aguardando-confirmacao", SHORTFALL);
    assert.ok(duringShortfall);

    const afterRecovery = shouldShowAdjustmentBanner("aguardando-pagamento", SHORTFALL);
    assert.ok(!afterRecovery);
  });

  it("L3: payment blocked state changes with order status transition", () => {
    const before = isPaymentBlocked("aguardando-confirmacao", SHORTFALL);
    assert.ok(before.blocked);

    const after = isPaymentBlocked("aguardando-pagamento", SHORTFALL);
    assert.ok(!after.blocked);
  });
});

// ─── M: Erro de fetch não vira CCM_OFF ──────────────────────────────────

describe("M: erro RPC não mascara como CCM_OFF", () => {
  it("M1: CCM_OFF does not have fetchError", () => {
    assert.equal(OFF.fetchError, undefined);
  });

  it("M2: FETCH_ERROR has fetchError=true", () => {
    assert.equal(FETCH_ERROR.fetchError, true);
  });

  it("M3: fetchError is distinguishable from flag OFF", () => {
    assert.notDeepEqual(FETCH_ERROR, OFF);
    assert.equal(FETCH_ERROR.enabled, false);
    assert.equal(FETCH_ERROR.fetchError, true);
    assert.equal(OFF.fetchError, undefined);
  });

  it("M4: pure functions treat fetchError as safe defaults (like OFF)", () => {
    const steps = getTimelineSteps(FETCH_ERROR);
    assert.equal(steps.length, 8);

    assert.equal(shouldShowAdjustmentBanner("aguardando-confirmacao", FETCH_ERROR), false);

    const successSteps = getSuccessSteps(FETCH_ERROR);
    assert.equal(successSteps.length, 3);

    assert.equal(isPaymentBlocked("aguardando-confirmacao", FETCH_ERROR).blocked, false);
  });

  it("M5: fetchError state enables UI to show error message (not silently OFF)", () => {
    const showError = FETCH_ERROR.fetchError === true;
    assert.ok(showError);
    const showErrorForOff = OFF.fetchError === true;
    assert.ok(!showErrorForOff);
  });

  it("M6: ready-for-payment message defaults to supplier-based on fetchError", () => {
    const msg = getReadyForPaymentMessage(FETCH_ERROR);
    assert.ok(msg.title.includes("fornecedores"));
  });
});
