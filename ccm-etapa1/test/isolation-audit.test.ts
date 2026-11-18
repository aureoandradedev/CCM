import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// TEST K: Isolation audit — RLS + no supplier data in public APIs
// ═══════════════════════════════════════════════════════════════════════════

const PROJECT_ROOT = path.resolve(import.meta.dirname!, "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

const OPERATIONAL_TABLES = [
  "holiday_calendars",
  "receiving_sessions",
  "receiving_items",
  "operational_exceptions",
  "exception_links",
  "shipment_occurrences",
  "supplier_performance_events",
];

function readMigrationFiles(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

test("K1: all operational tables have RLS enabled", () => {
  const sql = readMigrationFiles();
  for (const table of OPERATIONAL_TABLES) {
    const pattern = new RegExp(`ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY[^;]*${table}|${table}[^;]*ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i");
    const altPattern = new RegExp(`ALTER\\s+TABLE[^;]*${table}[^;]*ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i");
    assert.ok(pattern.test(sql) || altPattern.test(sql), `RLS not enabled for ${table}`);
  }
});

test("K2: all operational tables have admin-only policy", () => {
  const sql = readMigrationFiles();
  for (const table of OPERATIONAL_TABLES) {
    const policyPattern = new RegExp(`CREATE\\s+POLICY[^;]*${table}[^;]*is_admin`, "i");
    assert.ok(policyPattern.test(sql), `No admin-only policy for ${table}`);
  }
});

test("K3: supplier_performance_events has REVOKE for anon + authenticated", () => {
  const sql = readMigrationFiles();
  assert.ok(/REVOKE\s+ALL\s+ON\s+public\.supplier_performance_events\s+FROM\s+anon/i.test(sql));
  assert.ok(/REVOKE\s+ALL\s+ON\s+public\.supplier_performance_events\s+FROM\s+authenticated/i.test(sql));
});

test("K4: supplier_performance_events has correct GRANT (SELECT + INSERT only)", () => {
  const sql = readMigrationFiles();
  assert.ok(/GRANT\s+SELECT\s*,\s*INSERT\s+ON\s+public\.supplier_performance_events\s+TO\s+authenticated/i.test(sql));
  assert.ok(!/GRANT.*UPDATE.*ON\s+public\.supplier_performance_events/i.test(sql));
  assert.ok(!/GRANT.*DELETE.*ON\s+public\.supplier_performance_events/i.test(sql));
});

test("K5: no supplier_id exposed in public catalog data layer", () => {
  const catalogPath = path.join(PROJECT_ROOT, "src", "lib", "data", "catalog.ts");
  if (!fs.existsSync(catalogPath)) {
    return;
  }
  const content = fs.readFileSync(catalogPath, "utf-8");
  const publicFunctions = content.match(/export\s+(async\s+)?function\s+\w+/g) ?? [];

  for (const fn of publicFunctions) {
    const fnName = fn.replace(/export\s+(async\s+)?function\s+/, "");
    if (fnName.startsWith("admin")) continue;

    const fnStart = content.indexOf(fn);
    const fnBody = content.slice(fnStart, fnStart + 2000);
    const returnsSupplier = /supplier_id|supplier_name|supplierName|supplierId/.test(fnBody);
    if (returnsSupplier) {
      const selectMatch = fnBody.match(/\.select\(["`']([^"'`]+)/);
      if (selectMatch) {
        assert.ok(
          !selectMatch[1].includes("supplier_id"),
          `Public function ${fnName} selects supplier_id in catalog.ts`,
        );
      }
    }
  }
});

test("K6: shipment types in orders.ts does not leak supplier performance data", () => {
  const ordersPath = path.join(PROJECT_ROOT, "src", "lib", "orders.ts");
  if (!fs.existsSync(ordersPath)) return;
  const content = fs.readFileSync(ordersPath, "utf-8");
  assert.ok(
    !content.includes("supplier_performance"),
    "orders.ts should not reference supplier_performance_events",
  );
  assert.ok(
    !content.includes("SupplierOperationalKpis"),
    "orders.ts should not contain operational KPI types",
  );
});

test("K7: performance event types list matches migration CHECK constraint", async () => {
  const sql = readMigrationFiles();
  const checkMatch = sql.match(/supplier_performance_events[\s\S]*?CHECK\s*\(event_type\s+IN\s*\(([\s\S]*?)\)\)/);
  assert.ok(checkMatch, "Missing CHECK constraint on event_type");

  const { PERFORMANCE_EVENT_TYPES } = await import("../../src/lib/supplier-performance.ts");
  const inCheck = checkMatch![1];
  for (const t of PERFORMANCE_EVENT_TYPES) {
    assert.ok(inCheck.includes(`'${t}'`), `Event type '${t}' missing from migration CHECK`);
  }
});

test("K8: idempotency constraint exists in migration", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /spe_idempotency_unique\s+UNIQUE/i.test(sql) || /ADD\s+CONSTRAINT\s+spe_idempotency_unique/i.test(sql),
    "Idempotency unique constraint not found in migrations",
  );
});

test("K9: backend recorder uses ignoreDuplicates for idempotency", () => {
  const recorderPath = path.join(PROJECT_ROOT, "backend", "lib", "supplier-performance.mjs");
  if (!fs.existsSync(recorderPath)) return;
  const content = fs.readFileSync(recorderPath, "utf-8");
  assert.ok(content.includes("ignoreDuplicates: true"), "Backend recorder must use ignoreDuplicates: true");
});

test("K10: decidePurchaseOrder records performance events via upsert", () => {
  const actionsPath = path.join(PROJECT_ROOT, "src", "app", "admin", "actions.ts");
  const content = fs.readFileSync(actionsPath, "utf-8");
  assert.ok(
    content.includes("supplier_performance_events") && content.includes("ignoreDuplicates"),
    "decidePurchaseOrder should record events idempotently",
  );
});
