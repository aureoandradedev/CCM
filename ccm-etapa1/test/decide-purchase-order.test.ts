// Tests for decidePurchaseOrder logic: decision field mapping + constraint compliance.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Extract the pure logic from decidePurchaseOrder for testability.
// This mirrors the exact branching in src/app/(store)/admin/actions.ts:811-820.
function computeDecisionUpdate(decision: string) {
  const cancelDecisions = ["wait_next_cycle", "move_supplier"];
  const isSend = decision === "send";
  const newStatus = cancelDecisions.includes(decision) ? "cancelled" : "sent";
  return {
    decision: isSend ? null : decision,
    status: newStatus,
    sent_at: newStatus === "sent" ? "TIMESTAMP" : undefined,
  };
}

const VALID_DECISIONS = [
  "complete_order", "send_extra", "wait_next_cycle", "move_supplier", "pay_fee",
];

describe("decidePurchaseOrder: decision field mapping", () => {
  test('1. decision="send" from draft → status=sent, decision=NULL', () => {
    const r = computeDecisionUpdate("send");
    assert.equal(r.status, "sent");
    assert.equal(r.decision, null, "decision must be NULL for simple send");
    assert.equal(r.sent_at, "TIMESTAMP");
  });

  test('2. decision="send" from ready → status=sent, decision=NULL', () => {
    // Same logic regardless of source status (source status is filtered in WHERE clause)
    const r = computeDecisionUpdate("send");
    assert.equal(r.status, "sent");
    assert.equal(r.decision, null);
    assert.equal(r.sent_at, "TIMESTAMP");
  });

  test('3. decision="complete_order" → status=sent, decision preserved', () => {
    const r = computeDecisionUpdate("complete_order");
    assert.equal(r.status, "sent");
    assert.equal(r.decision, "complete_order");
    assert.equal(r.sent_at, "TIMESTAMP");
  });

  test('4. decision="wait_next_cycle" → status=cancelled, decision preserved', () => {
    const r = computeDecisionUpdate("wait_next_cycle");
    assert.equal(r.status, "cancelled");
    assert.equal(r.decision, "wait_next_cycle");
    assert.equal(r.sent_at, undefined, "no sent_at for cancelled");
  });

  test('5. decision="move_supplier" → status=cancelled, decision preserved', () => {
    const r = computeDecisionUpdate("move_supplier");
    assert.equal(r.status, "cancelled");
    assert.equal(r.decision, "move_supplier");
    assert.equal(r.sent_at, undefined);
  });

  test('6. decision="send_extra" → status=sent, decision preserved', () => {
    const r = computeDecisionUpdate("send_extra");
    assert.equal(r.status, "sent");
    assert.equal(r.decision, "send_extra");
    assert.equal(r.sent_at, "TIMESTAMP");
  });

  test('7. decision="pay_fee" → status=sent, decision preserved', () => {
    const r = computeDecisionUpdate("pay_fee");
    assert.equal(r.status, "sent");
    assert.equal(r.decision, "pay_fee");
    assert.equal(r.sent_at, "TIMESTAMP");
  });
});

describe("decidePurchaseOrder: constraint compliance", () => {
  test("5. all outputs satisfy supplier_purchase_orders_decision_check", () => {
    const allInputs = ["send", ...VALID_DECISIONS];
    for (const input of allInputs) {
      const r = computeDecisionUpdate(input);
      const ok = r.decision === null || VALID_DECISIONS.includes(r.decision);
      assert.ok(ok, `decision="${input}" → output decision="${r.decision}" must be NULL or in allowed list`);
    }
  });

  test('6. sent_at is set when status becomes "sent"', () => {
    const sendCases = ["send", "complete_order", "send_extra", "pay_fee"];
    for (const d of sendCases) {
      const r = computeDecisionUpdate(d);
      assert.equal(r.status, "sent");
      assert.ok(r.sent_at !== undefined, `sent_at must be set for decision="${d}"`);
    }
  });

  test("sent_at is NOT set when status becomes cancelled", () => {
    const cancelCases = ["wait_next_cycle", "move_supplier"];
    for (const d of cancelCases) {
      const r = computeDecisionUpdate(d);
      assert.equal(r.status, "cancelled");
      assert.equal(r.sent_at, undefined, `sent_at must be undefined for decision="${d}"`);
    }
  });
});
