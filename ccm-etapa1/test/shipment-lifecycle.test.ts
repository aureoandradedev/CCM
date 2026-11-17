import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHIPMENT_TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  validateTransition,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_EVENT_TYPES,
  OCCURRENCE_LABELS,
  type OccurrenceType,
} from "../../src/lib/shipment-lifecycle.ts";
import type { ShipmentStatus } from "../../src/lib/orders.ts";

// ═══════════════════════════════════════════════════════════════════════════
// TEST G: State machine — transitions, terminals, timestamps logic
// ═══════════════════════════════════════════════════════════════════════════

const ALL_STATUSES: ShipmentStatus[] = [
  "aguardando_disponibilidade",
  "preparando",
  "pronto_para_envio",
  "pronto_para_retirada",
  "enviado",
  "entregue",
  "cancelado",
];

test("G1: every status has an entry in SHIPMENT_TRANSITIONS", () => {
  for (const s of ALL_STATUSES) {
    assert.ok(s in SHIPMENT_TRANSITIONS, `Missing transitions for '${s}'`);
    assert.ok(Array.isArray(SHIPMENT_TRANSITIONS[s]), `SHIPMENT_TRANSITIONS['${s}'] must be an array`);
  }
});

test("G2: every status has a label in SHIPMENT_STATUS_LABEL", () => {
  for (const s of ALL_STATUSES) {
    assert.ok(s in SHIPMENT_STATUS_LABEL, `Missing label for '${s}'`);
    assert.ok(SHIPMENT_STATUS_LABEL[s].length > 0);
  }
});

test("G3: valid transitions — happy path delivery", () => {
  assert.ok(canTransition("aguardando_disponibilidade", "preparando"));
  assert.ok(canTransition("preparando", "pronto_para_envio"));
  assert.ok(canTransition("pronto_para_envio", "enviado"));
  assert.ok(canTransition("enviado", "entregue"));
});

test("G4: valid transitions — happy path pickup", () => {
  assert.ok(canTransition("aguardando_disponibilidade", "preparando"));
  assert.ok(canTransition("preparando", "pronto_para_retirada"));
  assert.ok(canTransition("pronto_para_retirada", "entregue"));
});

test("G5: cancellation allowed from non-sent states", () => {
  assert.ok(canTransition("aguardando_disponibilidade", "cancelado"));
  assert.ok(canTransition("preparando", "cancelado"));
  assert.ok(canTransition("pronto_para_envio", "cancelado"));
  assert.ok(canTransition("pronto_para_retirada", "cancelado"));
});

test("G6: enviado → cancelado NOT allowed", () => {
  assert.equal(canTransition("enviado", "cancelado"), false);
});

test("G7: terminal states have no outbound transitions", () => {
  assert.deepEqual(SHIPMENT_TRANSITIONS["entregue"], []);
  assert.deepEqual(SHIPMENT_TRANSITIONS["cancelado"], []);
});

test("G8: entregue is terminal — TERMINAL_STATUSES", () => {
  assert.ok(TERMINAL_STATUSES.has("entregue"));
});

test("G9: cancelado is terminal — TERMINAL_STATUSES", () => {
  assert.ok(TERMINAL_STATUSES.has("cancelado"));
});

test("G10: validateTransition blocks terminal → any", () => {
  for (const target of ALL_STATUSES) {
    const r1 = validateTransition("entregue", target);
    assert.equal(r1.valid, false, `entregue → ${target} should be invalid`);
    assert.ok(r1.reason?.includes("terminal"));

    const r2 = validateTransition("cancelado", target);
    assert.equal(r2.valid, false, `cancelado → ${target} should be invalid`);
    assert.ok(r2.reason?.includes("terminal"));
  }
});

test("G11: validateTransition blocks skip-state (aguardando → enviado)", () => {
  const r = validateTransition("aguardando_disponibilidade", "enviado");
  assert.equal(r.valid, false);
  assert.ok(r.reason?.includes("não permitida"));
});

test("G12: validateTransition blocks backwards (enviado → preparando)", () => {
  const r = validateTransition("enviado", "preparando");
  assert.equal(r.valid, false);
});

test("G13: validateTransition returns valid for allowed transition", () => {
  const r = validateTransition("preparando", "pronto_para_envio");
  assert.equal(r.valid, true);
  assert.equal(r.reason, undefined);
});

test("G14: no transition target appears that isn't a known status", () => {
  const known = new Set(ALL_STATUSES);
  for (const [from, targets] of Object.entries(SHIPMENT_TRANSITIONS)) {
    for (const t of targets) {
      assert.ok(known.has(t as ShipmentStatus), `Unknown target '${t}' from '${from}'`);
    }
  }
});

test("G15: delivery path cannot cross into pickup path", () => {
  assert.equal(canTransition("pronto_para_envio", "entregue"), false);
});

test("G16: pickup path cannot cross into delivery path", () => {
  assert.equal(canTransition("pronto_para_retirada", "enviado"), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST H: Event types + occurrence types
// ═══════════════════════════════════════════════════════════════════════════

test("H1: SHIPMENT_EVENT_TYPES has expected keys", () => {
  assert.equal(SHIPMENT_EVENT_TYPES.STATUS_CHANGED, "shipment_status_changed");
  assert.equal(SHIPMENT_EVENT_TYPES.TRACKING_SET, "shipment_tracking_set");
  assert.equal(SHIPMENT_EVENT_TYPES.OCCURRENCE, "shipment_occurrence");
});

test("H2: all occurrence types have labels", () => {
  const types: OccurrenceType[] = ["attempt", "delay", "damage", "return", "note"];
  for (const t of types) {
    assert.ok(t in OCCURRENCE_LABELS, `Missing label for occurrence type '${t}'`);
    assert.ok(OCCURRENCE_LABELS[t].length > 0);
  }
});

test("H3: OCCURRENCE_LABELS has exactly 5 entries", () => {
  assert.equal(Object.keys(OCCURRENCE_LABELS).length, 5);
});

test("H4: SHIPMENT_STATUS_LABEL covers all 7 statuses", () => {
  assert.equal(Object.keys(SHIPMENT_STATUS_LABEL).length, 7);
});

test("H5: transition map covers all 7 statuses", () => {
  assert.equal(Object.keys(SHIPMENT_TRANSITIONS).length, 7);
});

test("H6: non-terminal statuses have at least one transition", () => {
  for (const s of ALL_STATUSES) {
    if (!TERMINAL_STATUSES.has(s)) {
      assert.ok(SHIPMENT_TRANSITIONS[s].length > 0, `Non-terminal status '${s}' must have transitions`);
    }
  }
});
