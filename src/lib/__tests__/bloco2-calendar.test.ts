/**
 * Tests: Bloco 2 V2 — addBusinessMinutes + businessMinutesBetween
 *
 * Run: npx vitest run src/lib/__tests__/bloco2-calendar.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect } from "vitest";

import { addBusinessMinutes, businessMinutesBetween } from "../supplier-calendar";

const DEFAULT_CONFIG = {
  business_hours: {
    "1": { open: "08:00", close: "18:00" },
    "2": { open: "08:00", close: "18:00" },
    "3": { open: "08:00", close: "18:00" },
    "4": { open: "08:00", close: "18:00" },
    "5": { open: "08:00", close: "18:00" },
  },
};

describe("addBusinessMinutes", () => {
  it("adds minutes within the same business day", () => {
    const start = new Date("2026-11-23T10:00:00"); // Monday
    const result = addBusinessMinutes(start, 60, DEFAULT_CONFIG);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  it("returns start for 0 or negative minutes", () => {
    const start = new Date("2026-11-23T10:00:00");
    expect(addBusinessMinutes(start, 0, DEFAULT_CONFIG)).toEqual(start);
    expect(addBusinessMinutes(start, -5, DEFAULT_CONFIG)).toEqual(start);
  });

  it("rolls to next business day when exceeding close time", () => {
    const start = new Date("2026-11-23T17:00:00"); // Monday 5pm, 60 min left
    const result = addBusinessMinutes(start, 120, DEFAULT_CONFIG); // need 120 min
    // 60 min on Monday + 60 min on Tuesday = Tuesday 09:00
    const dateStr = result.toISOString().slice(0, 10);
    expect(dateStr).toBe("2026-11-24");
  });

  it("skips weekends (Saturday/Sunday)", () => {
    const friday = new Date("2026-11-27T17:30:00"); // Friday 5:30pm, only 30 min left
    const result = addBusinessMinutes(friday, 60, DEFAULT_CONFIG); // need 60 min
    // 30 min on Friday + skip Sat/Sun + 30 min on Monday = Monday 08:30
    const dateStr = result.toISOString().slice(0, 10);
    expect(dateStr).toBe("2026-11-30");
  });

  it("skips holidays", () => {
    const holidays = ["2026-11-24"]; // Tuesday is holiday
    const monday = new Date("2026-11-23T17:00:00"); // Monday 5pm
    const result = addBusinessMinutes(monday, 120, DEFAULT_CONFIG, holidays);
    // 60 min on Monday + skip Tuesday (holiday) + 60 min on Wednesday
    const dateStr = result.toISOString().slice(0, 10);
    expect(dateStr).toBe("2026-11-25");
  });

  it("null config uses default 08:00-18:00", () => {
    const start = new Date("2026-11-23T10:00:00");
    const result = addBusinessMinutes(start, 60, null);
    expect(result.getHours()).toBe(11);
  });

  it("before opening → snaps to opening time", () => {
    const early = new Date("2026-11-23T06:00:00"); // 6am Monday
    const result = addBusinessMinutes(early, 60, DEFAULT_CONFIG);
    expect(result.getHours()).toBe(9);
  });

  it("after closing → rolls to next day", () => {
    const late = new Date("2026-11-23T19:00:00"); // 7pm Monday
    const result = addBusinessMinutes(late, 60, DEFAULT_CONFIG);
    const dateStr = result.toISOString().slice(0, 10);
    expect(dateStr).toBe("2026-11-24");
    expect(result.getHours()).toBe(9);
  });
});

describe("businessMinutesBetween", () => {
  it("counts minutes within same business day", () => {
    const start = new Date("2026-11-23T10:00:00");
    const end = new Date("2026-11-23T12:00:00");
    expect(businessMinutesBetween(start, end, DEFAULT_CONFIG)).toBe(120);
  });

  it("returns 0 when end <= start", () => {
    const t = new Date("2026-11-23T10:00:00");
    expect(businessMinutesBetween(t, t, DEFAULT_CONFIG)).toBe(0);
    expect(businessMinutesBetween(t, new Date("2026-11-23T09:00:00"), DEFAULT_CONFIG)).toBe(0);
  });

  it("counts across two business days", () => {
    const start = new Date("2026-11-23T17:00:00"); // Monday 5pm
    const end = new Date("2026-11-24T09:00:00"); // Tuesday 9am
    // Monday: 60 min (17:00-18:00), Tuesday: 60 min (08:00-09:00)
    expect(businessMinutesBetween(start, end, DEFAULT_CONFIG)).toBe(120);
  });

  it("skips weekends", () => {
    const friday = new Date("2026-11-27T17:00:00"); // Friday 5pm
    const monday = new Date("2026-11-30T09:00:00"); // Monday 9am
    // Friday: 60 min (17:00-18:00), Sat/Sun = 0, Monday: 60 min (08:00-09:00)
    expect(businessMinutesBetween(friday, monday, DEFAULT_CONFIG)).toBe(120);
  });

  it("skips holidays", () => {
    const holidays = ["2026-11-24"];
    const monday = new Date("2026-11-23T17:00:00"); // Monday 5pm
    const wednesday = new Date("2026-11-25T09:00:00"); // Wednesday 9am
    // Monday: 60 min, Tuesday = holiday, Wednesday: 60 min
    expect(businessMinutesBetween(monday, wednesday, DEFAULT_CONFIG, holidays)).toBe(120);
  });

  it("null config uses default 08:00-18:00", () => {
    const start = new Date("2026-11-23T10:00:00");
    const end = new Date("2026-11-23T12:30:00");
    expect(businessMinutesBetween(start, end, null)).toBe(150);
  });

  it("before-open to after-close = full day of business hours", () => {
    const start = new Date("2026-11-23T06:00:00"); // before open
    const end = new Date("2026-11-23T20:00:00"); // after close
    // only counts 08:00-18:00 = 600 minutes
    expect(businessMinutesBetween(start, end, DEFAULT_CONFIG)).toBe(600);
  });
});

describe("addBusinessMinutes + businessMinutesBetween roundtrip", () => {
  it("adding N minutes then measuring back = N", () => {
    const start = new Date("2026-11-23T10:00:00"); // Monday
    const N = 180; // 3 hours
    const end = addBusinessMinutes(start, N, DEFAULT_CONFIG);
    const measured = businessMinutesBetween(start, end, DEFAULT_CONFIG);
    expect(measured).toBe(N);
  });

  it("roundtrip across weekend", () => {
    const start = new Date("2026-11-27T16:00:00"); // Friday 4pm
    const N = 300; // 5 business hours
    const end = addBusinessMinutes(start, N, DEFAULT_CONFIG);
    const measured = businessMinutesBetween(start, end, DEFAULT_CONFIG);
    expect(measured).toBe(N);
  });
});
