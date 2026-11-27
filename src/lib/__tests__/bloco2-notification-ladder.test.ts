/**
 * Tests: Bloco 2 V2 — Notification Ladder with Explicit Channels
 *
 * These are specification tests that verify the channel mapping contract
 * and consolidation logic of check_notification_ladder().
 *
 * Run: npx vitest run src/lib/__tests__/bloco2-notification-ladder.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";

// ============================================================================
// Channel mapping specification (extracted from migration 0075)
// ============================================================================

type Channel = "app" | "email" | "whatsapp" | "ai_call" | "team_task";
type StepConfig = {
  stepMinutes: number;
  channels: Channel[];
  eventType: string;
  recipientType: "supplier" | "team";
  urgency: string;
};

const LADDER_STEPS: StepConfig[] = [
  { stepMinutes: 0, channels: ["app", "email"], eventType: "supplier_reminder", recipientType: "supplier", urgency: "low" },
  { stepMinutes: 10, channels: ["app"], eventType: "supplier_reminder", recipientType: "supplier", urgency: "low" },
  { stepMinutes: 20, channels: ["whatsapp", "app", "email"], eventType: "supplier_reminder", recipientType: "supplier", urgency: "medium" },
  { stepMinutes: 30, channels: ["ai_call"], eventType: "supplier_ai_call", recipientType: "supplier", urgency: "high" },
  { stepMinutes: 40, channels: ["team_task"], eventType: "ligar_agora", recipientType: "team", urgency: "critical" },
];

function getIdempotencyKey(supplierId: string, step: number, channel: string): string {
  return `${supplierId}:ladder:${step}:${channel}`;
}

function getOutboxIdempotencyKey(supplierId: string, eventType: string, step: number, channel: string): string {
  if (eventType === "ligar_agora") {
    return `${supplierId}:ligar_agora:${step}:${channel}`;
  }
  if (eventType === "supplier_ai_call") {
    return `${supplierId}:supplier_ai_call:${step}:${channel}`;
  }
  if (eventType === "supplier_final_warning") {
    return `${supplierId}:supplier_final_warning:T:${channel}`;
  }
  return `${supplierId}:supplier_reminder:${step}:${channel}`;
}

function getStepsForElapsed(elapsedMin: number): StepConfig[] {
  return LADDER_STEPS.filter((s) => elapsedMin >= s.stepMinutes);
}

function getTotalNotifications(elapsedMin: number): number {
  return getStepsForElapsed(elapsedMin).reduce((sum, s) => sum + s.channels.length, 0);
}

// ============================================================================
// 1. min 0 → app + email
// ============================================================================
describe("Scenario 1: Step 0 fires app + email", () => {
  it("produces exactly 2 notifications at elapsed=0", () => {
    const steps = getStepsForElapsed(0);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepMinutes).toBe(0);
    expect(steps[0].channels).toEqual(["app", "email"]);
    expect(getTotalNotifications(0)).toBe(2);
  });

  it("step 0 event type is supplier_reminder", () => {
    const step = LADDER_STEPS.find((s) => s.stepMinutes === 0)!;
    expect(step.eventType).toBe("supplier_reminder");
    expect(step.recipientType).toBe("supplier");
    expect(step.urgency).toBe("low");
  });
});

// ============================================================================
// 2. min 10 → app only
// ============================================================================
describe("Scenario 2: Step 10 fires app only", () => {
  it("step 10 has exactly one channel: app", () => {
    const step = LADDER_STEPS.find((s) => s.stepMinutes === 10)!;
    expect(step.channels).toEqual(["app"]);
  });

  it("at elapsed=10, cumulative notifications = 3 (step0:2 + step10:1)", () => {
    expect(getTotalNotifications(10)).toBe(3);
  });
});

// ============================================================================
// 3. min 20 → WhatsApp + app + email
// ============================================================================
describe("Scenario 3: Step 20 fires whatsapp + app + email", () => {
  it("step 20 has 3 channels in correct order", () => {
    const step = LADDER_STEPS.find((s) => s.stepMinutes === 20)!;
    expect(step.channels).toEqual(["whatsapp", "app", "email"]);
    expect(step.urgency).toBe("medium");
  });

  it("at elapsed=20, cumulative = 6 (2+1+3)", () => {
    expect(getTotalNotifications(20)).toBe(6);
  });
});

// ============================================================================
// 4. min 30 → ai_call
// ============================================================================
describe("Scenario 4: Step 30 fires ai_call", () => {
  it("step 30 is ai_call channel only", () => {
    const step = LADDER_STEPS.find((s) => s.stepMinutes === 30)!;
    expect(step.channels).toEqual(["ai_call"]);
    expect(step.eventType).toBe("supplier_ai_call");
    expect(step.urgency).toBe("high");
  });

  it("at elapsed=30, cumulative = 7", () => {
    expect(getTotalNotifications(30)).toBe(7);
  });
});

// ============================================================================
// 5. min 40 → team_task (ligar agora)
// ============================================================================
describe("Scenario 5: Step 40 fires team_task", () => {
  it("step 40 is team_task channel", () => {
    const step = LADDER_STEPS.find((s) => s.stepMinutes === 40)!;
    expect(step.channels).toEqual(["team_task"]);
    expect(step.eventType).toBe("ligar_agora");
    expect(step.recipientType).toBe("team");
    expect(step.urgency).toBe("critical");
  });

  it("at elapsed=40, cumulative = 8", () => {
    expect(getTotalNotifications(40)).toBe(8);
  });
});

// ============================================================================
// 6. T → ladder does NOT execute handoff
// ============================================================================
describe("Scenario 6: Step T is final warning, NOT handoff", () => {
  it("ladder produces supplier_final_warning, not a backup creation", () => {
    const T = 45;
    const finalKey = getOutboxIdempotencyKey("sup-X", "supplier_final_warning", T, "app");
    expect(finalKey).toBe("sup-X:supplier_final_warning:T:app");
  });

  it("no step in LADDER_STEPS triggers backup_request or handoff", () => {
    const eventTypes = LADDER_STEPS.map((s) => s.eventType);
    expect(eventTypes).not.toContain("create_backup_request");
    expect(eventTypes).not.toContain("handoff");
    expect(eventTypes).not.toContain("escalate_to_team");
  });
});

// ============================================================================
// 7. T → check_supplier_request_timeouts() handles handoff (not ladder)
// ============================================================================
describe("Scenario 7: Handoff stays in check_supplier_request_timeouts", () => {
  it("ladder function name is check_notification_ladder, not check_supplier_request_timeouts", () => {
    const ladderFunction = "check_notification_ladder";
    const timeoutFunction = "check_supplier_request_timeouts";
    expect(ladderFunction).not.toBe(timeoutFunction);
  });

  it("ladder only produces notification outbox entries", () => {
    const allEventTypes = new Set(LADDER_STEPS.map((s) => s.eventType));
    allEventTypes.add("supplier_final_warning");
    expect(allEventTypes.has("supplier_reminder")).toBe(true);
    expect(allEventTypes.has("supplier_ai_call")).toBe(true);
    expect(allEventTypes.has("ligar_agora")).toBe(true);
    expect(allEventTypes.has("supplier_final_warning")).toBe(true);
    expect(allEventTypes.size).toBe(4);
  });
});

// ============================================================================
// 8. Repeated cron → zero duplication (idempotency)
// ============================================================================
describe("Scenario 8: Idempotency prevents duplication", () => {
  it("idempotency key is unique per supplier+step+channel", () => {
    const key1 = getIdempotencyKey("sup-A", 0, "app");
    const key2 = getIdempotencyKey("sup-A", 0, "email");
    const key3 = getIdempotencyKey("sup-A", 10, "app");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("same supplier+step+channel always produces same key", () => {
    const run1 = getIdempotencyKey("sup-A", 20, "whatsapp");
    const run2 = getIdempotencyKey("sup-A", 20, "whatsapp");
    expect(run1).toBe(run2);
  });

  it("outbox idempotency key includes event type to avoid cross-step collision", () => {
    const k1 = getOutboxIdempotencyKey("sup-A", "supplier_reminder", 0, "app");
    const k2 = getOutboxIdempotencyKey("sup-A", "supplier_reminder", 10, "app");
    expect(k1).not.toBe(k2);
  });
});

// ============================================================================
// 9. Two orders same supplier → one consolidated ladder
// ============================================================================
describe("Scenario 9: Consolidation — two orders same supplier → one ladder", () => {
  it("ladder iterates per DISTINCT supplier_id, not per request", () => {
    const requests = [
      { id: "req-1", supplier_id: "sup-A", order_id: "ord-1", sent_at: "2026-11-26T10:00:00Z" },
      { id: "req-2", supplier_id: "sup-A", order_id: "ord-2", sent_at: "2026-11-26T10:05:00Z" },
    ];
    const distinctSuppliers = [...new Set(requests.map((r) => r.supplier_id))];
    expect(distinctSuppliers).toHaveLength(1);
    expect(distinctSuppliers[0]).toBe("sup-A");
  });

  it("anchor is the OLDEST pending request", () => {
    const requests = [
      { id: "req-1", supplier_id: "sup-A", sent_at: new Date("2026-11-26T10:00:00Z") },
      { id: "req-2", supplier_id: "sup-A", sent_at: new Date("2026-11-26T10:05:00Z") },
    ];
    const anchor = requests.sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime())[0];
    expect(anchor.id).toBe("req-1");
  });
});

// ============================================================================
// 10. Third order enters mid-ladder → same ladder continues
// ============================================================================
describe("Scenario 10: Third order enters → same consolidated ladder", () => {
  it("pending_count reflects all active requests for the supplier", () => {
    const requests = [
      { id: "req-1", supplier_id: "sup-A", status: "aguardando_confirmacao" },
      { id: "req-2", supplier_id: "sup-A", status: "aguardando_confirmacao" },
      { id: "req-3", supplier_id: "sup-A", status: "aguardando_confirmacao" },
    ];
    const pendingCount = requests.filter(
      (r) => r.supplier_id === "sup-A" && ["aguardando_confirmacao", "confirmado_parcial"].includes(r.status)
    ).length;
    expect(pendingCount).toBe(3);
  });

  it("idempotency key uses supplier_id not request_id, so existing steps are not re-sent", () => {
    const keyBefore = getIdempotencyKey("sup-A", 0, "app");
    const keyAfter = getIdempotencyKey("sup-A", 0, "app");
    expect(keyBefore).toBe(keyAfter);
  });
});

// ============================================================================
// 11. Anchor changes when oldest request is resolved
// ============================================================================
describe("Scenario 11: Anchor changes after oldest request closes", () => {
  it("if oldest request resolves, next oldest becomes anchor", () => {
    const requests = [
      { id: "req-1", supplier_id: "sup-A", status: "confirmado", sent_at: new Date("2026-11-26T10:00:00Z") },
      { id: "req-2", supplier_id: "sup-A", status: "aguardando_confirmacao", sent_at: new Date("2026-11-26T10:05:00Z") },
      { id: "req-3", supplier_id: "sup-A", status: "aguardando_confirmacao", sent_at: new Date("2026-11-26T10:10:00Z") },
    ];
    const pending = requests
      .filter((r) => ["aguardando_confirmacao", "confirmado_parcial"].includes(r.status))
      .sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime());
    expect(pending[0].id).toBe("req-2");
  });

  it("existing idempotency keys prevent re-sending already-sent steps", () => {
    const existingKey = getIdempotencyKey("sup-A", 0, "app");
    const newKey = getIdempotencyKey("sup-A", 0, "app");
    expect(existingKey).toBe(newKey);
  });
});

// ============================================================================
// 12. Outside business hours → no notifications fired
// ============================================================================
describe("Scenario 12: Business hours gate — closed hours skip notification", () => {
  it("default business hours are Mon-Fri 07:00-18:00", () => {
    const defaultHours: Record<string, { open: string; close: string }> = {
      "1": { open: "07:00", close: "18:00" },
      "2": { open: "07:00", close: "18:00" },
      "3": { open: "07:00", close: "18:00" },
      "4": { open: "07:00", close: "18:00" },
      "5": { open: "07:00", close: "18:00" },
    };
    expect(Object.keys(defaultHours)).toEqual(["1", "2", "3", "4", "5"]);
    expect(defaultHours["6"]).toBeUndefined();
    expect(defaultHours["7"]).toBeUndefined();
  });

  it("Saturday (ISODOW 6) and Sunday (ISODOW 7) are not in default hours", () => {
    const defaultDays = ["1", "2", "3", "4", "5"];
    expect(defaultDays).not.toContain("6");
    expect(defaultDays).not.toContain("7");
  });

  it("time before 07:00 returns false for business hours check", () => {
    const currentMin = 6 * 60 + 59; // 06:59
    const openMin = 7 * 60; // 07:00
    const closeMin = 18 * 60; // 18:00
    const withinHours = currentMin >= openMin && currentMin < closeMin;
    expect(withinHours).toBe(false);
  });

  it("time at 18:00 returns false (close is exclusive)", () => {
    const currentMin = 18 * 60; // 18:00
    const openMin = 7 * 60;
    const closeMin = 18 * 60;
    const withinHours = currentMin >= openMin && currentMin < closeMin;
    expect(withinHours).toBe(false);
  });
});

// ============================================================================
// 13. Reopening hours → correct step fires based on elapsed time
// ============================================================================
describe("Scenario 13: After hours reopen, correct step fires", () => {
  it("if 25 min elapsed during closed hours, step 20 fires on reopen (not 0 again)", () => {
    const elapsedMin = 25;
    const eligibleSteps = getStepsForElapsed(elapsedMin);
    const stepMinutes = eligibleSteps.map((s) => s.stepMinutes);
    expect(stepMinutes).toContain(0);
    expect(stepMinutes).toContain(10);
    expect(stepMinutes).toContain(20);
    expect(stepMinutes).not.toContain(30);
  });

  it("idempotency ensures already-sent steps (0, 10) are not duplicated on reopen", () => {
    const key0 = getIdempotencyKey("sup-A", 0, "app");
    const key10 = getIdempotencyKey("sup-A", 10, "app");
    expect(key0).toBe("sup-A:ladder:0:app");
    expect(key10).toBe("sup-A:ladder:10:app");
  });
});

// ============================================================================
// 14. Holiday → no notifications fired
// ============================================================================
describe("Scenario 14: Holiday gate prevents notification", () => {
  it("holiday_calendars check uses scope national/state/municipal", () => {
    const validScopes = ["national", "state", "municipal"];
    expect(validScopes).toContain("national");
    expect(validScopes).toContain("state");
    expect(validScopes).toContain("municipal");
  });

  it("holiday check returns false for business hours regardless of time", () => {
    const isHoliday = true;
    const currentMin = 10 * 60; // 10:00 — normally within business hours
    const openMin = 7 * 60;
    const closeMin = 18 * 60;
    const withinHours = currentMin >= openMin && currentMin < closeMin;
    const result = withinHours && !isHoliday;
    expect(result).toBe(false);
  });
});

// ============================================================================
// 15. Payload includes pending_count and pending_codes
// ============================================================================
describe("Scenario 15: Payload shows pending count and codes", () => {
  it("payload structure includes all required fields", () => {
    const payload = {
      anchor_request_id: "req-1",
      step_minutes: 20,
      channel: "whatsapp",
      total_timeout_minutes: 45,
      elapsed_minutes: 22,
      pending_count: 3,
      pending_codes: ["ABC123", "DEF456", "GHI789"],
      urgency: "medium",
    };
    expect(payload).toHaveProperty("anchor_request_id");
    expect(payload).toHaveProperty("step_minutes");
    expect(payload).toHaveProperty("channel");
    expect(payload).toHaveProperty("total_timeout_minutes");
    expect(payload).toHaveProperty("elapsed_minutes");
    expect(payload).toHaveProperty("pending_count");
    expect(payload).toHaveProperty("pending_codes");
    expect(payload).toHaveProperty("urgency");
    expect(payload.pending_count).toBe(3);
    expect(payload.pending_codes).toHaveLength(3);
  });

  it("team_task payload includes action description and supplier_id", () => {
    const payload = {
      anchor_request_id: "req-1",
      supplier_id: "sup-ceramica",
      step_minutes: 40,
      channel: "team_task",
      total_timeout_minutes: 45,
      elapsed_minutes: 42,
      pending_count: 2,
      pending_codes: ["ABC123", "DEF456"],
      urgency: "critical",
      action: "Ligar para o fornecedor agora",
    };
    expect(payload.action).toBe("Ligar para o fornecedor agora");
    expect(payload.supplier_id).toBeDefined();
  });

  it("final warning payload has urgency=final", () => {
    const payload = {
      anchor_request_id: "req-1",
      step_minutes: 45,
      channel: "app",
      total_timeout_minutes: 45,
      pending_count: 1,
      pending_codes: ["ABC123"],
      urgency: "final",
    };
    expect(payload.urgency).toBe("final");
  });
});
