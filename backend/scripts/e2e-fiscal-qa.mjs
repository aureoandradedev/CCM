/**
 * E2E Fiscal QA — Steps 3-9 of fiscal closure process.
 * Creates [E2E-QA] data, runs full DAV lifecycle via mock, validates, cleans up.
 *
 * Usage: node backend/scripts/e2e-fiscal-qa.mjs
 * Requires: backend/.env with Supabase creds (service role)
 */
import { config } from "../lib/config.mjs";
import { db } from "../lib/supabase.mjs";
import {
  createFiscalDocument,
  syncFiscalDocStatus,
  cancelFiscalDocument,
  syncPendingDocuments,
  getFiscalDocsForOrder,
} from "../lib/fiscal/fiscal-service.mjs";
import { validateOrderValues, isEligibleForFiscal, FiscalValidationError } from "../lib/fiscal/dav-mapper.mjs";
import * as adapter from "../lib/fiscal/uniplus-dav-adapter.mjs";

const E2E_TAG = "[E2E-QA]";
let passed = 0;
let failed = 0;
const createdIds = { orders: [], orderItems: [], fiscalDocs: [] };

function assert(cond, label) {
  if (cond) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function insertTestOrder(overrides = {}) {
  const orderId = crypto.randomUUID();
  const code = `E2EQA-${Date.now().toString(36).toUpperCase()}`;

  const order = {
    id: orderId,
    code,
    customer: { name: `${E2E_TAG} Teste Fiscal`, document: "12345678901", email: "teste@e2e.local", phone: "62999990000" },
    address: { cep: "74000000", street: "Rua Teste", number: "1", complement: "", district: "Centro", city: "Goiania", state: "GO" },
    delivery_method: "delivery",
    payment_method: "pix",
    payment_status: "pago",
    order_status: "pagos",
    subtotal_centavos: 10000,
    discount_centavos: 0,
    freight_centavos: 1500,
    total_centavos: 11500,
    items_count: 2,
    pricing_version: 1,
    ...overrides,
  };

  const { data, error } = await db().from("orders").insert(order).select().single();
  if (error) throw new Error(`Insert order failed: ${error.message}`);
  createdIds.orders.push(data.id);
  return data;
}

async function insertTestItems(orderId, items) {
  const rows = items.map((it) => ({
    id: crypto.randomUUID(),
    order_id: orderId,
    name: `${E2E_TAG} ${it.name}`,
    sku: it.sku || "E2ESKU",
    qty: it.qty,
    unit_price_centavos: it.unit,
    retail_price_centavos: it.unit,
    line_centavos: it.line,
    unit: "UN",
  }));

  const { data, error } = await db().from("order_items").insert(rows).select();
  if (error) throw new Error(`Insert items failed: ${error.message}`);
  for (const r of data) createdIds.orderItems.push(r.id);
  return data;
}

// ── STEP 3: E2E fiscal mock against real DB ─────────────────────────

async function step3() {
  console.log("\n═══ STEP 3: E2E fiscal mock — full DAV lifecycle ═══");

  const order = await insertTestOrder();
  const items = await insertTestItems(order.id, [
    { name: "Arroz 5kg", sku: "ARZ5", qty: 2, unit: 2500, line: 5000 },
    { name: "Feijao 1kg", sku: "FEJ1", qty: 5, unit: 1000, line: 5000 },
  ]);

  // 3a: Create fiscal document (mock)
  const result = await createFiscalDocument(order, items);
  assert(!result.skipped, "3a: fiscal document was not skipped");
  assert(!result.idempotent, "3a: first call is not idempotent");
  assert(result.doc?.status === "created", "3a: status = created");
  assert(result.doc?.provider_reference != null, "3a: got provider_reference (mock codigo)");
  assert(result.doc?.codigo_ecommerce?.startsWith("CCM-"), "3a: codigo_ecommerce starts with CCM-");
  createdIds.fiscalDocs.push(result.doc.id);

  // 3b: Verify in DB
  const docs = await getFiscalDocsForOrder(order.id);
  assert(docs.length === 1, "3b: exactly 1 fiscal doc in DB");
  assert(docs[0].status === "created", "3b: DB status = created");

  // 3c: Sync status (mock returns status=1 → created, no change)
  const syncResult = await syncFiscalDocStatus(result.doc.id);
  assert(!syncResult.changed, "3c: sync with mock (status=1 → created) → no change");

  // 3d: Cancel
  const cancelResult = await cancelFiscalDocument(result.doc.id, "E2E test cleanup");
  assert(cancelResult.doc?.status === "cancelled", "3d: cancel → status = cancelled");
  assert(cancelResult.doc?.cancelled_at != null, "3d: cancelled_at timestamp set");

  // 3e: Verify cancelled in DB
  const docsAfter = await getFiscalDocsForOrder(order.id);
  assert(docsAfter[0].status === "cancelled", "3e: DB confirms cancelled");

  return order;
}

// ── STEP 4: Idempotency real test ───────────────────────────────────

async function step4() {
  console.log("\n═══ STEP 4: Idempotency — no duplicate docs ═══");

  const order = await insertTestOrder({ code: `E2EQA-IDEMP-${Date.now().toString(36)}` });
  const items = await insertTestItems(order.id, [
    { name: "Leite 1L", sku: "LT1", qty: 10, unit: 1000, line: 10000 },
  ]);

  // First call — creates
  const r1 = await createFiscalDocument(order, items);
  assert(r1.doc?.status === "created", "4a: first call → created");
  createdIds.fiscalDocs.push(r1.doc.id);

  // Second call — idempotent (finds existing)
  const r2 = await createFiscalDocument(order, items);
  assert(r2.idempotent === true, "4b: second call → idempotent=true");
  assert(r2.doc?.id === r1.doc?.id, "4b: same doc id (no duplicate)");

  // Verify DB has only 1 doc for this order
  const docs = await getFiscalDocsForOrder(order.id);
  const active = docs.filter((d) => d.status !== "cancelled");
  assert(active.length === 1, "4c: DB has exactly 1 active doc (no duplicate)");

  // Cancel for cleanup
  await cancelFiscalDocument(r1.doc.id, "E2E cleanup");
}

// ── STEP 5: Value validation ────────────────────────────────────────

async function step5() {
  console.log("\n═══ STEP 5: Value validation — subtotal-desconto+frete=total ═══");

  // 5a: Correct values pass
  const valid = { subtotal_centavos: 10000, discount_centavos: 500, freight_centavos: 1500, total_centavos: 11000 };
  const result = validateOrderValues(valid, [{ line_centavos: 10000 }]);
  assert(result.total === 11000, "5a: correct values pass validation");

  // 5b: Divergence blocked
  const bad = { subtotal_centavos: 10000, discount_centavos: 0, freight_centavos: 1500, total_centavos: 9999 };
  let threw = false;
  try {
    validateOrderValues(bad, [{ line_centavos: 10000 }]);
  } catch (err) {
    threw = err instanceof FiscalValidationError;
  }
  assert(threw, "5b: divergent values throw FiscalValidationError");

  // 5c: Item sum mismatch
  let threw2 = false;
  const mismatch = { subtotal_centavos: 10000, discount_centavos: 0, freight_centavos: 0, total_centavos: 10000 };
  try {
    validateOrderValues(mismatch, [{ line_centavos: 5000 }, { line_centavos: 4000 }]);
  } catch (err) {
    threw2 = err instanceof FiscalValidationError && err.details?.errors?.some((e) => /Soma dos itens/.test(e));
  }
  assert(threw2, "5c: item sum mismatch throws FiscalValidationError");

  // 5d: Real DB test — invalid values rejected by service
  const order = await insertTestOrder({
    code: `E2EQA-VAL-${Date.now().toString(36)}`,
    subtotal_centavos: 10000,
    discount_centavos: 0,
    freight_centavos: 1500,
    total_centavos: 9999,
  });
  const items = await insertTestItems(order.id, [
    { name: "Teste Val", sku: "TV1", qty: 1, unit: 10000, line: 10000 },
  ]);
  const valResult = await createFiscalDocument(order, items);
  assert(valResult.skipped === true, "5d: service skips order with inconsistent values");
  assert(valResult.reason === "VALIDATION_ERROR", "5d: reason = VALIDATION_ERROR");
}

// ── STEP 6: Feature flag proof ──────────────────────────────────────

async function step6() {
  console.log("\n═══ STEP 6: Feature flag — FISCAL_UNIPLUS_ENABLED=false ═══");

  const info = adapter.adapterInfo();
  assert(info.mock === true, "6a: adapterInfo reports mock=true");
  assert(info.provider === "uniplus_dav", "6a: provider = uniplus_dav");
  assert(config.fiscalUniplusEnabled === false, "6b: config.fiscalUniplusEnabled is false");

  // 6c: mock findDavByCodigoEcommerce returns not-found
  const found = await adapter.findDavByCodigoEcommerce("CCM-TEST-X");
  assert(found.found === false, "6c: mock findDavByCodigoEcommerce → found=false");

  // 6d: mock cancelDav returns status 3
  const cancel = await adapter.cancelDav("9999");
  assert(cancel.raw?.status === 3, "6d: mock cancelDav returns status=3 (cancelled)");
}

// ── STEP 7: Status validation — all 6 statuses via mock ─────────────

async function step7() {
  console.log("\n═══ STEP 7: Status validation — 6 statuses + transitions ═══");

  const order = await insertTestOrder({ code: `E2EQA-STS-${Date.now().toString(36)}` });
  const items = await insertTestItems(order.id, [
    { name: "Status Test", sku: "ST1", qty: 1, unit: 10000, line: 10000 },
  ]);

  // Create → status = created (via pending → sending → created)
  const r = await createFiscalDocument(order, items);
  createdIds.fiscalDocs.push(r.doc.id);

  // Verify transitions happened: attempt_count > 0, sent_at set
  assert(r.doc.attempt_count >= 1, "7a: attempt_count incremented");
  assert(r.doc.sent_at != null, "7a: sent_at timestamp set");
  assert(r.doc.status === "created", "7a: final status = created");

  // Sync → still created (mock status=1)
  const sync = await syncFiscalDocStatus(r.doc.id);
  assert(!sync.changed, "7b: sync mock → no change (already created)");

  // Cancel → cancelled
  const cancel = await cancelFiscalDocument(r.doc.id, "step7 test");
  assert(cancel.doc.status === "cancelled", "7c: cancel → cancelled");
  assert(cancel.doc.cancelled_at != null, "7c: cancelled_at set");

  // Terminal check — trying to sync a cancelled doc
  const termSync = await syncFiscalDocStatus(cancel.doc.id);
  assert(termSync.skipped === true, "7d: sync on cancelled doc → skipped");
  assert(termSync.reason === "TERMINAL_STATUS", "7d: reason = TERMINAL_STATUS");

  // Test eligibility checks
  const ineligible1 = isEligibleForFiscal({ id: "x", order_status: "cancelado", payment_status: "pago", customer: { document: "111" }, total_centavos: 100 });
  assert(!ineligible1.eligible, "7e: cancelled order → not eligible");

  const ineligible2 = isEligibleForFiscal({ id: "x", order_status: "pagos", payment_status: "pendente", customer: { document: "111" }, total_centavos: 100 });
  assert(!ineligible2.eligible, "7f: unpaid order → not eligible");

  const ineligible3 = isEligibleForFiscal({ id: "x", order_status: "pagos", payment_status: "pago", customer: {}, total_centavos: 100 });
  assert(!ineligible3.eligible, "7g: no document → not eligible");
}

// ── STEP 8: Admin UI validation (structural) ────────────────────────

async function step8() {
  console.log("\n═══ STEP 8: Admin UI — fiscal panel + routes structural ═══");

  // We validate that fiscal routes/actions exist and admin-only
  // Testing route protection: /api/fiscal/status without auth should be blocked
  // (This is a structural test — we verify the code exists and exports correctly)

  const { default: fiscalRouter } = await import("../routes/fiscal.mjs");
  assert(typeof fiscalRouter === "function", "8a: fiscal router exported as Express router");

  // Check route endpoints registered
  const routes = [];
  fiscalRouter.stack?.forEach((layer) => {
    if (layer.route) routes.push(`${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  });
  assert(routes.includes("GET /status"), "8b: GET /status registered");
  assert(routes.includes("GET /order/:orderId"), "8b: GET /order/:orderId registered");
  assert(routes.includes("POST /emit"), "8b: POST /emit registered");
  assert(routes.includes("POST /sync/:docId"), "8b: POST /sync/:docId registered");
  assert(routes.includes("POST /sync-all"), "8b: POST /sync-all registered");
  assert(routes.includes("POST /cancel/:docId"), "8b: POST /cancel/:docId registered");

  // Verify all routes use exigirAdmin middleware
  let allProtected = true;
  fiscalRouter.stack?.forEach((layer) => {
    if (layer.route) {
      const handlers = layer.route.stack?.map((s) => s.name) || [];
      if (!handlers.includes("exigirAdmin")) allProtected = false;
    }
  });
  assert(allProtected, "8c: all fiscal routes use exigirAdmin middleware");
}

// ── STEP 9: Cleanup ─────────────────────────────────────────────────

async function step9() {
  console.log("\n═══ STEP 9: Cleanup — remove [E2E-QA] data ═══");

  // Delete fiscal docs first (FK constraint)
  if (createdIds.fiscalDocs.length) {
    const { error: e1 } = await db().from("fiscal_documents").delete().in("id", createdIds.fiscalDocs);
    assert(!e1, `9a: deleted ${createdIds.fiscalDocs.length} fiscal docs`);
    if (e1) console.error("  Fiscal delete error:", e1.message);
  }

  // Also clean any remaining fiscal docs for created orders
  if (createdIds.orders.length) {
    const { error: ef } = await db().from("fiscal_documents").delete().in("order_id", createdIds.orders);
    if (ef) console.error("  Extra fiscal delete error:", ef.message);
  }

  // Delete items
  if (createdIds.orderItems.length) {
    const { error: e2 } = await db().from("order_items").delete().in("id", createdIds.orderItems);
    assert(!e2, `9b: deleted ${createdIds.orderItems.length} order items`);
    if (e2) console.error("  Items delete error:", e2.message);
  }

  // Delete orders
  if (createdIds.orders.length) {
    const { error: e3 } = await db().from("orders").delete().in("id", createdIds.orders);
    assert(!e3, `9c: deleted ${createdIds.orders.length} orders`);
    if (e3) console.error("  Orders delete error:", e3.message);
  }

  // Verify no E2E data remains
  const { data: remaining } = await db()
    .from("fiscal_documents")
    .select("id")
    .like("codigo_ecommerce", "CCM-E2EQA-%");
  assert(!remaining?.length, "9d: no E2E fiscal docs remain in DB");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   E2E Fiscal QA — Steps 3-9 (mock, no Uniplus) ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nFISCAL_UNIPLUS_ENABLED = ${config.fiscalUniplusEnabled}`);
  console.log(`Supabase URL = ${config.supabaseUrl ? "configured" : "MISSING"}\n`);

  if (config.fiscalUniplusEnabled) {
    console.error("ABORT: FISCAL_UNIPLUS_ENABLED=true — this script runs ONLY with mock");
    process.exit(1);
  }

  try {
    await step3();
    await step4();
    await step5();
    await step6();
    await step7();
    await step8();
  } finally {
    await step9();
  }

  console.log("\n════════════════════════════════════════════════════");
  console.log(`RESULTADO: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  step9().catch(() => {});
  process.exit(2);
});
