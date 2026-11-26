// Tests for strict receiving classification invariant:
// accepted_qty + damaged_qty = received_qty
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateReceivingItem,
  summarizeReceiving,
  type ReceivingItemInput,
} from "../../src/lib/receiving.ts";

function makeItem(overrides: Partial<ReceivingItemInput> = {}): ReceivingItemInput {
  return {
    purchaseOrderItemId: "poi-1",
    masterProductId: "mp-1",
    expectedQty: 10,
    receivedQty: 10,
    acceptedQty: 10,
    damagedQty: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-3. Strict equality validation (pure function)
// ═══════════════════════════════════════════════════════════════════════════

describe("Strict invariant: accepted + damaged === received", () => {
  test("1. accepted + damaged < received → invalid", () => {
    const r = validateReceivingItem(makeItem({
      receivedQty: 10,
      acceptedQty: 5,
      damagedQty: 2,
    }));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("must equal")));
  });

  test("2. accepted + damaged === received → valid", () => {
    const r = validateReceivingItem(makeItem({
      receivedQty: 10,
      acceptedQty: 8,
      damagedQty: 2,
    }));
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  test("3. accepted + damaged > received → invalid", () => {
    const r = validateReceivingItem(makeItem({
      receivedQty: 5,
      acceptedQty: 4,
      damagedQty: 3,
    }));
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("must equal")));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-5. UX auto-fill logic (unit test of the pure logic)
// ═══════════════════════════════════════════════════════════════════════════

describe("UX auto-fill logic", () => {
  function simulateUpdateField(
    item: { receivedQty: number; acceptedQty: number; damagedQty: number },
    field: string,
    value: number,
  ) {
    const updated = { ...item, [field]: value };
    if (field === "receivedQty") {
      updated.acceptedQty = value;
      updated.damagedQty = 0;
    }
    return updated;
  }

  test("4. Recebido changes → Aceito auto-fills to same value", () => {
    const before = { receivedQty: 0, acceptedQty: 0, damagedQty: 0 };
    const after = simulateUpdateField(before, "receivedQty", 7);
    assert.equal(after.acceptedQty, 7);
  });

  test("5. Recebido changes → Avariado resets to 0", () => {
    const before = { receivedQty: 5, acceptedQty: 3, damagedQty: 2 };
    const after = simulateUpdateField(before, "receivedQty", 8);
    assert.equal(after.damagedQty, 0);
    assert.equal(after.acceptedQty, 8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-7. Backend validation (recordItem + completeReceiving logic)
// ═══════════════════════════════════════════════════════════════════════════

describe("Backend strict validation logic", () => {
  function checkRecordItemValidation(acceptedQty: number, damagedQty: number, receivedQty: number) {
    if (acceptedQty + damagedQty !== receivedQty) {
      throw new Error("A quantidade recebida deve ser totalmente classificada entre aceita e avariada.");
    }
    return true;
  }

  test("6. recordItem rejects accepted + damaged !== received", () => {
    assert.throws(
      () => checkRecordItemValidation(0, 0, 1),
      { message: "A quantidade recebida deve ser totalmente classificada entre aceita e avariada." },
    );
    assert.doesNotThrow(() => checkRecordItemValidation(1, 0, 1));
    assert.doesNotThrow(() => checkRecordItemValidation(3, 2, 5));
  });

  test("7. completeReceiving rejects when any item has accepted + damaged !== received", () => {
    function checkCompleteBarrier(items: Array<{ accepted_qty: number; damaged_qty: number; received_qty: number }>) {
      const unclassified = items.filter(
        (i) => i.accepted_qty + i.damaged_qty !== i.received_qty,
      );
      if (unclassified.length > 0) {
        throw new Error("Todos os itens devem ter accepted + damaged = received antes de finalizar.");
      }
      return true;
    }

    assert.throws(
      () => checkCompleteBarrier([
        { accepted_qty: 1, damaged_qty: 0, received_qty: 1 },
        { accepted_qty: 0, damaged_qty: 0, received_qty: 1 },
      ]),
      { message: /antes de finalizar/ },
    );

    assert.doesNotThrow(
      () => checkCompleteBarrier([
        { accepted_qty: 1, damaged_qty: 0, received_qty: 1 },
        { accepted_qty: 3, damaged_qty: 2, received_qty: 5 },
      ]),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Summary with strict classification
// ═══════════════════════════════════════════════════════════════════════════

test("8. summarizeReceiving with strict classification — all classified items", () => {
  const items: ReceivingItemInput[] = [
    makeItem({ expectedQty: 10, receivedQty: 10, acceptedQty: 8, damagedQty: 2 }),
    makeItem({ purchaseOrderItemId: "poi-2", expectedQty: 5, receivedQty: 3, acceptedQty: 2, damagedQty: 1 }),
  ];
  for (const item of items) {
    const v = validateReceivingItem(item);
    assert.equal(v.valid, true, `item ${item.purchaseOrderItemId} must be valid under strict invariant`);
  }
  const s = summarizeReceiving(items);
  assert.equal(s.totalExpected, 15);
  assert.equal(s.totalReceived, 13);
  assert.equal(s.totalAccepted, 10);
  assert.equal(s.totalDamaged, 3);
  assert.equal(s.totalAccepted + s.totalDamaged, s.totalReceived);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. WJ8848 bug scenario: accepted=0, received=1 must now be invalid
// ═══════════════════════════════════════════════════════════════════════════

test("9. WJ8848 bug scenario: accepted=0 damaged=0 received=1 is now rejected", () => {
  const r = validateReceivingItem(makeItem({
    expectedQty: 1,
    receivedQty: 1,
    acceptedQty: 0,
    damagedQty: 0,
  }));
  assert.equal(r.valid, false, "must be invalid: 0+0 !== 1");
  assert.ok(r.errors.some((e) => e.includes("must equal")));
});
