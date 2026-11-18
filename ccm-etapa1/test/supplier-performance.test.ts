import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERFORMANCE_EVENT_TYPES,
  PERFORMANCE_EVENT_LABEL,
  aggregateOperationalKpis,
  type PerformanceEvent,
  type PerformanceEventType,
} from "../../src/lib/supplier-performance.ts";

function makeEvent(type: PerformanceEventType, metricValue: number | null = null): PerformanceEvent {
  return {
    id: crypto.randomUUID(),
    supplier_id: "SUP-001",
    event_type: type,
    reference_type: "purchase_order",
    reference_id: crypto.randomUUID(),
    metric_value: metricValue,
    data: {},
    created_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST I: Performance events — types, labels, aggregation
// ═══════════════════════════════════════════════════════════════════════════

test("I1: PERFORMANCE_EVENT_TYPES has exactly 11 types", () => {
  assert.equal(PERFORMANCE_EVENT_TYPES.length, 11);
});

test("I2: every event type has a Portuguese label", () => {
  for (const t of PERFORMANCE_EVENT_TYPES) {
    assert.ok(PERFORMANCE_EVENT_LABEL[t], `Missing label for '${t}'`);
    assert.ok(PERFORMANCE_EVENT_LABEL[t].length > 0);
  }
});

test("I3: aggregateOperationalKpis returns correct counts", () => {
  const events: PerformanceEvent[] = [
    makeEvent("po_sent"),
    makeEvent("po_sent"),
    makeEvent("po_sent"),
    makeEvent("po_confirmed", 2.5),
    makeEvent("po_confirmed", 4.5),
    makeEvent("delivery_on_time"),
    makeEvent("delivery_on_time"),
    makeEvent("delivery_late", 8),
    makeEvent("receiving_full_match"),
    makeEvent("receiving_full_match"),
    makeEvent("receiving_shortage", 3),
    makeEvent("receiving_damage", 1),
    makeEvent("receiving_excess", 2),
    makeEvent("receiving_swap"),
    makeEvent("cut_from_cycle"),
  ];

  const kpis = aggregateOperationalKpis(events);

  assert.equal(kpis.posSent, 3);
  assert.equal(kpis.posConfirmed, 2);
  assert.equal(kpis.deliveriesOnTime, 2);
  assert.equal(kpis.deliveriesLate, 1);
  assert.equal(kpis.receivingsFullMatch, 2);
  assert.equal(kpis.receivingsWithShortage, 1);
  assert.equal(kpis.receivingsWithDamage, 1);
  assert.equal(kpis.receivingsWithExcess, 1);
  assert.equal(kpis.receivingsWithSwap, 1);
  assert.equal(kpis.cutFromCycle, 1);
  assert.equal(kpis.totalEvents, 15);
});

test("I4: confirmation rate computed correctly", () => {
  const events = [
    makeEvent("po_sent"),
    makeEvent("po_sent"),
    makeEvent("po_sent"),
    makeEvent("po_confirmed", 3),
    makeEvent("po_confirmed", 5),
  ];
  const kpis = aggregateOperationalKpis(events);
  assert.equal(kpis.confirmationRate, 66.7);
});

test("I5: avgConfirmationHours computed from metric_value", () => {
  const events = [
    makeEvent("po_confirmed", 2),
    makeEvent("po_confirmed", 6),
    makeEvent("po_confirmed", 10),
  ];
  const kpis = aggregateOperationalKpis(events);
  assert.equal(kpis.avgConfirmationHours, 6);
});

test("I6: on-time rate with zero deliveries returns null", () => {
  const events = [makeEvent("po_sent")];
  const kpis = aggregateOperationalKpis(events);
  assert.equal(kpis.onTimeRate, null);
});

test("I7: empty events returns all zeroes and null rates", () => {
  const kpis = aggregateOperationalKpis([]);
  assert.equal(kpis.posSent, 0);
  assert.equal(kpis.posConfirmed, 0);
  assert.equal(kpis.confirmationRate, null);
  assert.equal(kpis.avgConfirmationHours, null);
  assert.equal(kpis.shortageRate, null);
  assert.equal(kpis.damageRate, null);
  assert.equal(kpis.onTimeRate, null);
  assert.equal(kpis.totalEvents, 0);
});

test("I8: shortage rate uses full_match + shortage as denominator", () => {
  const events = [
    makeEvent("receiving_full_match"),
    makeEvent("receiving_full_match"),
    makeEvent("receiving_full_match"),
    makeEvent("receiving_shortage", 5),
  ];
  const kpis = aggregateOperationalKpis(events);
  assert.equal(kpis.shortageRate, 25);
});

test("I9: no automatic actions derived from KPIs (pure function returns data only)", () => {
  const events = [
    makeEvent("delivery_late", 24),
    makeEvent("delivery_late", 48),
    makeEvent("receiving_shortage", 100),
    makeEvent("receiving_damage", 50),
  ];
  const kpis = aggregateOperationalKpis(events);
  assert.equal(typeof kpis.shortageRate, "number");
  assert.equal(typeof kpis.damageRate, "number");
  assert.ok(!("action" in kpis));
  assert.ok(!("recommendation" in kpis));
  assert.ok(!("score" in kpis));
  assert.ok(!("ranking" in kpis));
});
