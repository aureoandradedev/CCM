import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveHolidays,
  resolveSupplierCutoff,
  subtractMinutesFromTime,
  findNextValidOrderDay,
  calculateExpectedAvailabilityDateV2,
  isAfterSupplierCutoff,
  type HolidayEntry,
  type SupplierTermsForCalendar,
} from "../../src/lib/supplier-calendar.ts";

const date = (s: string) => new Date(s + "T12:00:00");

// ============================================================================
// TEST A: resolveHolidays — resolve per context, national+state+municipal, dedup
// ============================================================================

test("A1: resolveHolidays: national holidays always included", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-12-25" },
    { scope: "national", holiday_date: "2026-01-01" },
  ];
  const result = resolveHolidays(null, null, calendars);
  assert.deepEqual(result, ["2026-01-01", "2026-12-25"]);
});

test("A2: resolveHolidays: state holidays matched by context state", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-12-25" },
    { scope: "state", state_code: "GO", holiday_date: "2026-10-24" },
    { scope: "state", state_code: "SP", holiday_date: "2026-07-09" },
  ];
  const result = resolveHolidays("GO", null, calendars);
  assert.ok(result.includes("2026-10-24"));
  assert.ok(!result.includes("2026-07-09"));
});

test("A3: resolveHolidays: municipal holidays matched by context city", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-12-25" },
    { scope: "municipal", state_code: "GO", city_name: "Goiânia", holiday_date: "2026-10-24" },
    { scope: "municipal", state_code: "GO", city_name: "Anápolis", holiday_date: "2026-07-26" },
  ];
  const result = resolveHolidays("GO", "Goiânia", calendars);
  assert.ok(result.includes("2026-10-24"));
  assert.ok(!result.includes("2026-07-26"));
});

test("A4: resolveHolidays: different context resolves different holidays", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-12-25" },
    { scope: "state", state_code: "GO", holiday_date: "2026-10-24" },
    { scope: "municipal", state_code: "SP", city_name: "São Paulo", holiday_date: "2026-01-25" },
  ];
  const goResult = resolveHolidays("GO", "Goiânia", calendars);
  const spResult = resolveHolidays("SP", "São Paulo", calendars);
  assert.ok(goResult.includes("2026-10-24"));
  assert.ok(!goResult.includes("2026-01-25"));
  assert.ok(!spResult.includes("2026-10-24"));
  assert.ok(spResult.includes("2026-01-25"));
  assert.ok(goResult.includes("2026-12-25")); // national in both
  assert.ok(spResult.includes("2026-12-25"));
});

test("A5: resolveHolidays: dedup same date from multiple scopes", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-12-25" },
    { scope: "state", state_code: "GO", holiday_date: "2026-12-25" },
  ];
  const result = resolveHolidays("GO", null, calendars);
  assert.equal(result.length, 1);
  assert.equal(result[0], "2026-12-25");
});

test("A6: resolveHolidays: empty calendars → empty result", () => {
  const result = resolveHolidays("GO", "Goiânia", []);
  assert.deepEqual(result, []);
});

// ============================================================================
// TEST B: resolveSupplierCutoff — business hours, lead_time, fallback chain
// ============================================================================

test("B1: resolveSupplierCutoff: business hours close − lead time", () => {
  const terms = {
    business_hours: { "1": { open: "08:00", close: "17:00" } },
    lead_time_minutes: 30,
    cutoff_time: null,
  };
  const result = resolveSupplierCutoff(terms, 1);
  assert.equal(result.cutoffTime, "16:30");
  assert.equal(result.isOpen, true);
});

test("B2: resolveSupplierCutoff: day not in business_hours → closed", () => {
  const terms = {
    business_hours: { "1": { open: "08:00", close: "17:00" } },
    lead_time_minutes: 30,
    cutoff_time: null,
  };
  const result = resolveSupplierCutoff(terms, 6); // sábado
  assert.equal(result.isOpen, false);
});

test("B3: resolveSupplierCutoff: no business_hours → cutoff_time", () => {
  const terms = {
    business_hours: null,
    lead_time_minutes: 30,
    cutoff_time: "16:00",
  };
  const result = resolveSupplierCutoff(terms, 1);
  assert.equal(result.cutoffTime, "16:00");
  assert.equal(result.isOpen, true);
});

test("B4: resolveSupplierCutoff: no terms → global default", () => {
  const result = resolveSupplierCutoff(null, 1, "18:00");
  assert.equal(result.cutoffTime, "18:00");
  assert.equal(result.isOpen, true);
});

test("B5: resolveSupplierCutoff: no terms, no global → 17:30", () => {
  const result = resolveSupplierCutoff(null, 1);
  assert.equal(result.cutoffTime, "17:30");
});

test("B6: resolveSupplierCutoff: empty business_hours obj → cutoff_time fallback", () => {
  const terms = {
    business_hours: {} as Record<string, { open: string; close: string }>,
    lead_time_minutes: 30,
    cutoff_time: "15:00",
  };
  const result = resolveSupplierCutoff(terms, 1);
  assert.equal(result.cutoffTime, "15:00");
});

test("B7: subtractMinutesFromTime: 17:00 − 30 = 16:30", () => {
  assert.equal(subtractMinutesFromTime("17:00", 30), "16:30");
});

test("B8: subtractMinutesFromTime: 08:00 − 15 = 07:45", () => {
  assert.equal(subtractMinutesFromTime("08:00", 15), "07:45");
});

test("B9: subtractMinutesFromTime: underflow clamps to 00:00", () => {
  assert.equal(subtractMinutesFromTime("00:10", 30), "00:00");
});

// ============================================================================
// TEST C: findNextValidOrderDay + calculateExpectedAvailabilityDateV2
// ============================================================================

const baseTerms: SupplierTermsForCalendar = {
  dias_pedido: [1, 3, 5], // seg, qua, sex
  business_hours: {
    "1": { open: "08:00", close: "17:00" },
    "2": { open: "08:00", close: "17:00" },
    "3": { open: "08:00", close: "17:00" },
    "4": { open: "08:00", close: "17:00" },
    "5": { open: "08:00", close: "17:00" },
  },
  lead_time_minutes: 30,
  cutoff_time: null,
  prazo_entrega_cd_dias: 2,
};

test("C1: findNextValidOrderDay: today is valid order day before cutoff", () => {
  // 2026-11-16 = segunda = dow 1 (seg), and 1 is in dias_pedido
  const d = findNextValidOrderDay(baseTerms, [], "17:30", {
    date: date("2026-11-16"), time: "10:00",
  });
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-16");
});

test("C2: findNextValidOrderDay: today valid but after cutoff → next day", () => {
  // 2026-11-16 = segunda, cutoff = 16:30. Time = 17:00 → next qua 18
  const d = findNextValidOrderDay(baseTerms, [], "17:30", {
    date: date("2026-11-16"), time: "17:00",
  });
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-18"); // qua
});

test("C3: findNextValidOrderDay: today is holiday → skip to next valid", () => {
  // 2026-11-16 = segunda = feriado → next qua 18
  const d = findNextValidOrderDay(baseTerms, ["2026-11-16"], "17:30", {
    date: date("2026-11-16"), time: "10:00",
  });
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-18");
});

test("C4: findNextValidOrderDay: supplier closed on Saturday", () => {
  // 2026-11-21 = sábado = not in dias_pedido AND not in business_hours
  const d = findNextValidOrderDay(baseTerms, [], "17:30", {
    date: date("2026-11-21"), time: "10:00",
  });
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-23"); // seg
});

test("C5: findNextValidOrderDay: no dias_pedido → null", () => {
  const terms = { ...baseTerms, dias_pedido: [] };
  const d = findNextValidOrderDay(terms, [], "17:30", {
    date: date("2026-11-16"), time: "10:00",
  });
  assert.equal(d, null);
});

test("C6: findNextValidOrderDay: does NOT anticipate to previous day", () => {
  // 2026-11-17 = terça, not in dias_pedido [1,3,5] → goes FORWARD to qua 18
  const d = findNextValidOrderDay(baseTerms, [], "17:30", {
    date: date("2026-11-17"), time: "10:00",
  });
  assert.equal(d?.toISOString().slice(0, 10), "2026-11-18"); // qua, not seg 16
});

test("C7: calculateExpectedAvailabilityDateV2: full calendar calculation", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-11-15" }, // domingo, doesn't matter
    { scope: "state", state_code: "GO", holiday_date: "2026-11-19" }, // quinta
  ];
  // 2026-11-16 = seg, before cutoff → order day = seg 16
  // prazo = 2 dias úteis. Holidays: 11/19 (quinta).
  // 16(seg) → +1 = 17(ter) → +1 = 18(qua). But holiday 19 is not counted (it's after the 2 days).
  // Actually: addBusinessDays(16, 2, holidays) = ter 17 (day1), qua 18 (day2) = 2026-11-18
  const result = calculateExpectedAvailabilityDateV2(
    baseTerms, "GO", "Goiânia", "GO", "Goiânia", calendars, "17:30",
    { date: date("2026-11-16"), time: "10:00" },
  );
  assert.ok(result);
  assert.equal(result!.orderDay, "2026-11-16");
  assert.equal(result!.availabilityDate, "2026-11-18");
});

test("C8: calculateExpectedAvailabilityDateV2: holiday impacts delivery", () => {
  const calendars: HolidayEntry[] = [
    { scope: "national", holiday_date: "2026-11-17" }, // terça = feriado
  ];
  // 2026-11-16 = seg → order day = 16. prazo = 2 dias úteis.
  // addBusinessDays(16, 2, [17]): 17 is holiday, skip → 18(qua)=day1, 19(qui)=day2
  const result = calculateExpectedAvailabilityDateV2(
    baseTerms, null, null, null, null, calendars, "17:30",
    { date: date("2026-11-16"), time: "10:00" },
  );
  assert.ok(result);
  assert.equal(result!.orderDay, "2026-11-16");
  assert.equal(result!.availabilityDate, "2026-11-19");
});

test("C9: isAfterSupplierCutoff: before cutoff → false", () => {
  const terms = {
    business_hours: { "1": { open: "08:00", close: "17:00" } },
    lead_time_minutes: 30,
    cutoff_time: null,
  };
  const result = isAfterSupplierCutoff(terms, "17:30", {
    date: date("2026-11-16"), time: "15:00",
  });
  assert.equal(result, false);
});

test("C10: isAfterSupplierCutoff: after cutoff → true", () => {
  const terms = {
    business_hours: { "1": { open: "08:00", close: "17:00" } },
    lead_time_minutes: 30,
    cutoff_time: null,
  };
  const result = isAfterSupplierCutoff(terms, "17:30", {
    date: date("2026-11-16"), time: "16:35",
  });
  assert.equal(result, true);
});

test("C11: isAfterSupplierCutoff: closed day → true", () => {
  const terms = {
    business_hours: { "1": { open: "08:00", close: "17:00" } },
    lead_time_minutes: 30,
    cutoff_time: null,
  };
  // 2026-11-21 = sábado (ISO dow 6), not in business_hours
  const result = isAfterSupplierCutoff(terms, "17:30", {
    date: date("2026-11-21"), time: "10:00",
  });
  assert.equal(result, true);
});

// ============================================================================
// TEST D: Calendar separation — supplier vs CD vs third city
// ============================================================================
// Calendários NÃO se misturam. Feriado do CD não bloqueia fornecedor.
// Feriado do fornecedor não bloqueia CD.

test("D1: supplier open + CD municipal holiday → supplier still accepts order", () => {
  // Fornecedor em SP/Campinas, CD em GO/Goiânia
  // Feriado municipal APENAS em Goiânia (CD) no dia 2026-11-16 (segunda)
  const calendars: HolidayEntry[] = [
    { scope: "municipal", state_code: "GO", city_name: "Goiânia", holiday_date: "2026-11-16" },
  ];

  // Supplier holidays: resolve for SP/Campinas → NO holidays (Goiânia holiday not included)
  const supplierHolidays = resolveHolidays("SP", "Campinas", calendars);
  assert.ok(!supplierHolidays.includes("2026-11-16"), "CD holiday must NOT appear in supplier calendar");

  // CD holidays: resolve for GO/Goiânia → HAS 2026-11-16
  const cdHolidays = resolveHolidays("GO", "Goiânia", calendars);
  assert.ok(cdHolidays.includes("2026-11-16"), "CD holiday must appear in CD calendar");

  // Supplier can still receive order on 2026-11-16
  const orderDay = findNextValidOrderDay(baseTerms, supplierHolidays, "17:30", {
    date: date("2026-11-16"), time: "10:00",
  });
  assert.equal(orderDay?.toISOString().slice(0, 10), "2026-11-16");
});

test("D2: supplier municipal holiday → order advances, CD unaffected", () => {
  // Fornecedor em SP/Campinas, CD em GO/Goiânia
  // Feriado municipal APENAS em Campinas (fornecedor) no dia 2026-11-16 (segunda)
  const calendars: HolidayEntry[] = [
    { scope: "municipal", state_code: "SP", city_name: "Campinas", holiday_date: "2026-11-16" },
  ];

  // Supplier holidays: has 2026-11-16
  const supplierHolidays = resolveHolidays("SP", "Campinas", calendars);
  assert.ok(supplierHolidays.includes("2026-11-16"));

  // CD holidays: does NOT have 2026-11-16
  const cdHolidays = resolveHolidays("GO", "Goiânia", calendars);
  assert.ok(!cdHolidays.includes("2026-11-16"), "Supplier holiday must NOT appear in CD calendar");

  // Supplier order advances past the holiday
  const orderDay = findNextValidOrderDay(baseTerms, supplierHolidays, "17:30", {
    date: date("2026-11-16"), time: "10:00",
  });
  assert.equal(orderDay?.toISOString().slice(0, 10), "2026-11-18"); // qua, skips segunda
});

test("D3: supplier delivers on CD holiday → CD availability advances", () => {
  // Fornecedor em SP/Campinas, CD em GO/Goiânia
  // Feriado municipal em Goiânia no dia 2026-11-17 (terça)
  // Pedido segunda 16, prazo 2 dias úteis
  // Sem feriado no CD: disponível qua 18
  // COM feriado no CD na terça 17: terça não conta → disponível qui 19
  const calendars: HolidayEntry[] = [
    { scope: "municipal", state_code: "GO", city_name: "Goiânia", holiday_date: "2026-11-17" },
  ];

  const result = calculateExpectedAvailabilityDateV2(
    baseTerms,
    "SP", "Campinas",    // supplier
    "GO", "Goiânia",     // CD
    calendars, "17:30",
    { date: date("2026-11-16"), time: "10:00" },
  );
  assert.ok(result);
  assert.equal(result!.orderDay, "2026-11-16"); // supplier open (no SP/Campinas holiday)
  assert.equal(result!.availabilityDate, "2026-11-19"); // CD skips terça (Goiânia holiday)
});

test("D4: third city holiday does not interfere with supplier or CD", () => {
  // Fornecedor em SP/Campinas, CD em GO/Goiânia
  // Feriado municipal em RJ/Rio de Janeiro no dia 2026-11-16 (segunda)
  const calendars: HolidayEntry[] = [
    { scope: "municipal", state_code: "RJ", city_name: "Rio de Janeiro", holiday_date: "2026-11-16" },
  ];

  const supplierHolidays = resolveHolidays("SP", "Campinas", calendars);
  const cdHolidays = resolveHolidays("GO", "Goiânia", calendars);

  assert.ok(!supplierHolidays.includes("2026-11-16"), "Third city holiday must not affect supplier");
  assert.ok(!cdHolidays.includes("2026-11-16"), "Third city holiday must not affect CD");

  // Full calculation unaffected
  const result = calculateExpectedAvailabilityDateV2(
    baseTerms,
    "SP", "Campinas",
    "GO", "Goiânia",
    calendars, "17:30",
    { date: date("2026-11-16"), time: "10:00" },
  );
  assert.ok(result);
  assert.equal(result!.orderDay, "2026-11-16");
  assert.equal(result!.availabilityDate, "2026-11-18"); // normal, no interference
});
