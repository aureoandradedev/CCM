import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// ═══════════════════════════════════════════════════════════════════════════
// TEST L: Fiscal module — mapper, idempotency, status, security, config
// ═══════════════════════════════════════════════════════════════════════════

const PROJECT_ROOT = path.resolve(import.meta.dirname!, "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

function readMigrationFiles(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

// --- L1: fiscal_documents table exists with correct columns ---
test("L1: fiscal_documents table in migration with required columns", () => {
  const sql = readMigrationFiles();
  assert.ok(/CREATE\s+TABLE.*fiscal_documents/i.test(sql), "fiscal_documents table not found");
  for (const col of [
    "order_id",
    "shipment_id",
    "provider",
    "provider_reference",
    "codigo_ecommerce",
    "status",
    "attempt_count",
    "payload_hash",
    "raw_response",
    "last_error",
    "sent_at",
    "invoiced_at",
    "cancelled_at",
  ]) {
    assert.ok(sql.includes(col), `Column ${col} not found in fiscal_documents`);
  }
});

// --- L2: fiscal_documents has RLS enabled ---
test("L2: fiscal_documents has RLS enabled", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /ALTER\s+TABLE\s+public\.fiscal_documents\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql),
    "RLS not enabled for fiscal_documents",
  );
});

// --- L3: fiscal_documents has admin-only policy ---
test("L3: fiscal_documents has admin-only policy", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE\s+POLICY[\s\S]*?fiscal_documents[\s\S]*?is_admin/i.test(sql),
    "No admin-only policy for fiscal_documents",
  );
});

// --- L4: fiscal_documents REVOKE for anon + authenticated ---
test("L4: fiscal_documents has REVOKE for anon + authenticated", () => {
  const sql = readMigrationFiles();
  assert.ok(/REVOKE\s+ALL\s+ON\s+public\.fiscal_documents\s+FROM\s+anon/i.test(sql));
  assert.ok(/REVOKE\s+ALL\s+ON\s+public\.fiscal_documents\s+FROM\s+authenticated/i.test(sql));
});

// --- L5: idempotency constraint ---
test("L5: fiscal_documents has idempotency unique index", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /idx_fiscal_doc_idempotency/i.test(sql) && /UNIQUE/i.test(sql),
    "Idempotency unique index not found",
  );
});

// --- L6: codigoECommerce unique index ---
test("L6: fiscal_documents has codigoECommerce unique index", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /idx_fiscal_doc_codigo_ecommerce/i.test(sql) && /UNIQUE/i.test(sql),
    "codigoECommerce unique index not found",
  );
});

// --- L7: fiscal status CHECK constraint ---
test("L7: fiscal_documents status CHECK includes all expected values", () => {
  const sql = readMigrationFiles();
  for (const status of ["pending", "sending", "created", "invoiced", "cancelled", "error"]) {
    assert.ok(
      new RegExp(`'${status}'`).test(sql),
      `Status '${status}' missing from CHECK constraint`,
    );
  }
});

// --- L8: fiscal types — status transitions ---
test("L8: fiscal status transitions are well-defined", async () => {
  const typesPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "fiscal-types.mjs");
  const content = fs.readFileSync(typesPath, "utf-8");

  assert.ok(content.includes("canTransitionFiscal"), "canTransitionFiscal not exported");
  assert.ok(content.includes("isTerminalFiscalStatus"), "isTerminalFiscalStatus not exported");
  assert.ok(content.includes("FISCAL_STATUS_TRANSITIONS"), "FISCAL_STATUS_TRANSITIONS not exported");

  const { canTransitionFiscal, isTerminalFiscalStatus, FISCAL_STATUS_TRANSITIONS } = await import(pathToFileURL(typesPath).href);

  assert.ok(canTransitionFiscal("pending", "sending"), "pending → sending should be valid");
  assert.ok(canTransitionFiscal("pending", "error"), "pending → error should be valid");
  assert.ok(canTransitionFiscal("sending", "created"), "sending → created should be valid");
  assert.ok(canTransitionFiscal("created", "invoiced"), "created → invoiced should be valid");
  assert.ok(canTransitionFiscal("created", "cancelled"), "created → cancelled should be valid");
  assert.ok(!canTransitionFiscal("invoiced", "cancelled"), "invoiced → cancelled should be invalid");
  assert.ok(!canTransitionFiscal("cancelled", "pending"), "cancelled → pending should be invalid");

  assert.ok(isTerminalFiscalStatus("invoiced"), "invoiced should be terminal");
  assert.ok(isTerminalFiscalStatus("cancelled"), "cancelled should be terminal");
  assert.ok(!isTerminalFiscalStatus("created"), "created should NOT be terminal");
  assert.ok(!isTerminalFiscalStatus("pending"), "pending should NOT be terminal");

  assert.deepEqual(FISCAL_STATUS_TRANSITIONS.invoiced, [], "invoiced has no transitions");
  assert.deepEqual(FISCAL_STATUS_TRANSITIONS.cancelled, [], "cancelled has no transitions");
});

// --- L9: DAV mapper — value validation ---
test("L9: validateOrderValues catches reconciliation errors", async () => {
  const mapperPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "dav-mapper.mjs");
  const { validateOrderValues, FiscalValidationError } = await import(pathToFileURL(mapperPath).href);

  const valid = { subtotal_centavos: 10000, discount_centavos: 500, freight_centavos: 800, total_centavos: 10300 };
  const result = validateOrderValues(valid, []);
  assert.equal(result.subtotal, 10000);
  assert.equal(result.total, 10300);

  const bad = { subtotal_centavos: 10000, discount_centavos: 500, freight_centavos: 800, total_centavos: 9999 };
  let threw = false;
  try {
    validateOrderValues(bad, []);
  } catch (err: unknown) {
    threw = true;
    assert.ok(err instanceof FiscalValidationError, "Should be FiscalValidationError");
    assert.ok((err as Error).message.includes("inconsistentes"), "Message should mention value inconsistency");
  }
  assert.ok(threw, "Should throw for bad total");
});

// --- L10: DAV mapper — codigoECommerce generation ---
test("L10: generateCodigoEcommerce uses order code and optional shipment", async () => {
  const { generateCodigoEcommerce } = await import(
    pathToFileURL(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "dav-mapper.mjs")).href
  );

  assert.equal(generateCodigoEcommerce("CC1234"), "CCM-CC1234");
  assert.equal(generateCodigoEcommerce("CC1234", "ship-001"), "CCM-CC1234-ship-001");
});

// --- L11: DAV mapper — isEligibleForFiscal ---
test("L11: isEligibleForFiscal checks payment + status + document", async () => {
  const { isEligibleForFiscal } = await import(
    pathToFileURL(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "dav-mapper.mjs")).href
  );

  const good = {
    id: "uuid",
    order_status: "em-separacao",
    payment_status: "pago",
    customer: { document: "12345678901" },
    total_centavos: 5000,
  };
  assert.ok(isEligibleForFiscal(good).eligible, "Eligible order should pass");

  const noPayment = { ...good, payment_status: "pendente" };
  assert.ok(!isEligibleForFiscal(noPayment).eligible, "Unpaid should fail");

  const cancelled = { ...good, order_status: "cancelado" };
  assert.ok(!isEligibleForFiscal(cancelled).eligible, "Cancelled should fail");

  const noDoc = { ...good, customer: { document: "" } };
  assert.ok(!isEligibleForFiscal(noDoc).eligible, "No document should fail");

  const zeroTotal = { ...good, total_centavos: 0 };
  assert.ok(!isEligibleForFiscal(zeroTotal).eligible, "Zero total should fail");
});

// --- L12: DAV mapper — buildUniplusDavPayload ---
test("L12: buildUniplusDavPayload builds correct structure", async () => {
  const mapperPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "dav-mapper.mjs");
  const { buildUniplusDavPayload } = await import(pathToFileURL(mapperPath).href);

  const order = {
    code: "CC0001",
    customer: { name: "Teste", document: "12345678901", phone: "62999999999", email: "t@t.com" },
    address: { cep: "74000000", street: "Rua A", number: "10", complement: "", district: "Centro", city: "Goiania", state: "GO" },
    subtotal_centavos: 10000,
    discount_centavos: 0,
    freight_centavos: 500,
    total_centavos: 10500,
  };
  const items = [
    { product_id: "p1", sku: "SKU1", name: "Produto A", unit: "UN", qty: 2, unit_price_centavos: 5000, line_centavos: 10000 },
  ];

  const { payload, codigoEcommerce, payloadHash } = buildUniplusDavPayload(order, items);

  assert.equal(codigoEcommerce, "CCM-CC0001");
  assert.ok(payloadHash.length > 0, "payloadHash should not be empty");
  assert.equal(payload.codigoECommerce, "CCM-CC0001");
  assert.equal(payload.cliente.tipoPessoa, "F");
  assert.equal(payload.cliente.documento, "12345678901");
  assert.equal(payload.itens.length, 1);
  assert.equal(payload.itens[0].quantidade, 2);
  assert.equal(payload.itens[0].valorUnitario, 50);
  assert.equal(payload.valores.subtotal, 100);
  assert.equal(payload.valores.total, 105);
});

// --- L13: DAV mapper — PJ payload ---
test("L13: buildUniplusDavPayload handles PJ (CNPJ) documents", async () => {
  const { buildUniplusDavPayload } = await import(
    pathToFileURL(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "dav-mapper.mjs")).href
  );

  const order = {
    code: "CC0002",
    customer: { name: "Empresa S.A.", document: "12345678000199", phone: "62999999999", email: "e@e.com", razao_social: "Empresa S.A. LTDA" },
    address: null,
    subtotal_centavos: 20000,
    discount_centavos: 1000,
    freight_centavos: 0,
    total_centavos: 19000,
  };
  const items = [
    { product_id: "p2", sku: "SKU2", name: "Produto B", unit: "KG", qty: 10, unit_price_centavos: 2000, line_centavos: 20000 },
  ];

  const { payload } = buildUniplusDavPayload(order, items);
  assert.equal(payload.cliente.tipoPessoa, "J");
  assert.equal(payload.cliente.razaoSocial, "Empresa S.A. LTDA");
  assert.equal(payload.endereco, null);
});

// --- L14: config has fiscal vars ---
test("L14: config.mjs exports fiscal config vars", async () => {
  const configPath = path.join(PROJECT_ROOT, "backend", "lib", "config.mjs");
  const content = fs.readFileSync(configPath, "utf-8");

  for (const key of [
    "fiscalUniplusEnabled",
    "uniplusBaseUrl",
    "uniplusToken",
    "uniplusFilial",
    "uniplusVendedor",
    "uniplusCondicaoFinanceira",
    "uniplusTipoDocumento",
    "uniplusTimeoutMs",
    "uniplusMaxRetries",
  ]) {
    assert.ok(content.includes(key), `Config key '${key}' not found in config.mjs`);
  }
});

// --- L15: .env.example has fiscal vars ---
test("L15: .env.example documents fiscal env vars", () => {
  const envPath = path.join(PROJECT_ROOT, "backend", ".env.example");
  const content = fs.readFileSync(envPath, "utf-8");

  for (const v of [
    "FISCAL_UNIPLUS_ENABLED",
    "UNIPLUS_BASE_URL",
    "UNIPLUS_TOKEN",
    "UNIPLUS_FILIAL",
    "UNIPLUS_VENDEDOR",
    "UNIPLUS_CONDICAO_FINANCEIRA",
    "UNIPLUS_TIPO_DOCUMENTO",
  ]) {
    assert.ok(content.includes(v), `Env var ${v} not documented in .env.example`);
  }
});

// --- L16: fiscal_documents has feature flag config ---
test("L16: migration inserts fiscal_uniplus_enabled config", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /fiscal_uniplus_enabled/.test(sql) && /false/.test(sql),
    "fiscal_uniplus_enabled config not inserted with default false",
  );
});

// --- L17: adapter never logs token or credentials ---
test("L17: adapter code does not log sensitive data", () => {
  const adapterPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "uniplus-dav-adapter.mjs");
  const content = fs.readFileSync(adapterPath, "utf-8");

  const logLines = content.split("\n").filter((l) => /console\.(log|info|warn|error)/.test(l));
  for (const line of logLines) {
    assert.ok(!line.includes("config.uniplusToken"), `Adapter logs token: ${line.trim()}`);
    assert.ok(!line.includes("cachedToken"), `Adapter logs cached token: ${line.trim()}`);
  }
});

// --- L18: fiscal service never logs raw_response ---
test("L18: fiscal service sanitizes log data", () => {
  const servicePath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "fiscal-service.mjs");
  const content = fs.readFileSync(servicePath, "utf-8");

  assert.ok(content.includes("delete safe.token"), "fiscalLog should delete token");
  assert.ok(content.includes("delete safe.authorization"), "fiscalLog should delete authorization");
  assert.ok(content.includes("delete safe.raw_response"), "fiscalLog should delete raw_response");
});

// --- L19: shipment_id nullable allows both strategies ---
test("L19: fiscal_documents shipment_id is nullable (supports per_order and per_shipment)", () => {
  const sql = readMigrationFiles();
  const tableMatch = sql.match(/CREATE\s+TABLE.*fiscal_documents[\s\S]*?\);/i);
  assert.ok(tableMatch, "fiscal_documents CREATE TABLE not found");
  const tableSql = tableMatch![0];
  assert.ok(tableSql.includes("shipment_id"), "shipment_id column exists");
  assert.ok(!tableSql.includes("shipment_id") || !tableSql.match(/shipment_id\s+uuid\s+NOT\s+NULL/i), "shipment_id should be nullable");
});

// --- L20: adapter module structure ---
test("L20: adapter exports required functions", () => {
  const adapterPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "uniplus-dav-adapter.mjs");
  const content = fs.readFileSync(adapterPath, "utf-8");

  for (const fn of ["createDav", "getDavStatus", "findDavByCodigoEcommerce", "cancelDav"]) {
    assert.ok(content.includes(`export async function ${fn}`), `Missing export: ${fn}`);
  }
});

// --- L21: adapter uses OAuth2 client_credentials flow ---
test("L21: adapter uses OAuth2 client_credentials with Basic auth", () => {
  const adapterPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "uniplus-dav-adapter.mjs");
  const content = fs.readFileSync(adapterPath, "utf-8");
  assert.ok(content.includes("grant_type=client_credentials"), "Must use client_credentials flow");
  assert.ok(content.includes("scope=public-api"), "Must request public-api scope");
  assert.ok(content.includes("Basic"), "Must use Basic auth for token request");
  assert.ok(content.includes("/oauth/token"), "Must use /oauth/token endpoint");
});

// --- L22: adapter uses correct Uniplus API path ---
test("L22: adapter uses /public-api/v1/davs endpoint", () => {
  const adapterPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "uniplus-dav-adapter.mjs");
  const content = fs.readFileSync(adapterPath, "utf-8");
  assert.ok(content.includes("/public-api/v1/davs"), "Must use /public-api/v1/davs");
  assert.ok(content.includes("codigoECommerce.eq="), "findDav must use query param codigoECommerce.eq=");
});

// --- L23: adapter wraps payload in {dav: ...} for create ---
test("L23: createDav wraps payload in {dav: ...} envelope", () => {
  const adapterPath = path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "uniplus-dav-adapter.mjs");
  const content = fs.readFileSync(adapterPath, "utf-8");
  assert.ok(
    content.includes("dav") && (content.includes("wrapped") || content.includes("{ dav:")),
    "createDav must wrap payload in {dav: ...} format",
  );
});

// --- L24: fiscal route exists and requires admin ---
test("L24: fiscal route mounted and all handlers require admin", () => {
  const routePath = path.join(PROJECT_ROOT, "backend", "routes", "fiscal.mjs");
  assert.ok(fs.existsSync(routePath), "backend/routes/fiscal.mjs must exist");
  const content = fs.readFileSync(routePath, "utf-8");
  const handlers = content.match(/router\.(get|post|put|delete)\([^)]+/g) ?? [];
  assert.ok(handlers.length >= 4, `Expected at least 4 route handlers, found ${handlers.length}`);
  for (const h of handlers) {
    assert.ok(h.includes("exigirAdmin"), `Route handler must require admin: ${h}`);
  }
});

// --- L25: servidor.mjs mounts /api/fiscal ---
test("L25: servidor.mjs mounts fiscal route", () => {
  const content = fs.readFileSync(path.join(PROJECT_ROOT, "backend", "servidor.mjs"), "utf-8");
  assert.ok(content.includes('"/api/fiscal"') || content.includes("'/api/fiscal'"), "Must mount at /api/fiscal");
  assert.ok(content.includes("fiscal"), "Must import fiscal route");
});

// --- L26: no SEFAZ or certificado digital references ---
test("L26: fiscal module does not reference SEFAZ or certificado digital", () => {
  const fiscalDir = path.join(PROJECT_ROOT, "backend", "lib", "fiscal");
  const files = fs.readdirSync(fiscalDir).filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const content = fs.readFileSync(path.join(fiscalDir, f), "utf-8").toLowerCase();
    assert.ok(!content.includes("sefaz"), `${f} must not reference SEFAZ`);
    assert.ok(!content.includes("certificado digital"), `${f} must not reference certificado digital`);
  }
});

// --- L27: no setInterval/cron in fiscal service ---
test("L27: fiscal service has no cron, interval or scheduler", () => {
  const content = fs.readFileSync(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "fiscal-service.mjs"), "utf-8");
  assert.ok(!content.includes("setInterval"), "Must not use setInterval");
  assert.ok(!content.includes("setTimeout") || content.includes("AbortSignal.timeout"), "Must not use setTimeout for scheduling");
  assert.ok(!/\bcron\b/i.test(content), "Must not reference cron");
});

// --- L28: service uses adapter, never direct fetch ---
test("L28: fiscal service delegates HTTP to adapter", () => {
  const content = fs.readFileSync(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "fiscal-service.mjs"), "utf-8");
  assert.ok(!content.includes("fetch("), "Service must NOT call fetch directly — adapter handles HTTP");
  assert.ok(content.includes("adapter"), "Service must import adapter");
});

// --- L29: admin UI - FiscalStatusPanel ---
test("L29: FiscalStatusPanel exists and order detail uses it", () => {
  const panel = path.join(PROJECT_ROOT, "src", "components", "admin", "fiscal-status-panel.tsx");
  assert.ok(fs.existsSync(panel), "FiscalStatusPanel component must exist");
  const content = fs.readFileSync(panel, "utf-8");
  assert.ok(content.includes("FiscalStatusPanel"), "Must export FiscalStatusPanel");
  assert.ok(content.includes("syncFiscalDoc") || content.includes("handleSync"), "Must have sync action");
  assert.ok(content.includes("retryFiscalDoc") || content.includes("handleRetry"), "Must have retry action");

  const page = fs.readFileSync(path.join(PROJECT_ROOT, "src", "app", "(store)", "admin", "pedidos", "[code]", "page.tsx"), "utf-8");
  assert.ok(page.includes("FiscalStatusPanel"), "Order detail must render FiscalStatusPanel");
  assert.ok(page.includes("fiscalDocs"), "Order detail must destructure fiscalDocs");
});

// --- L30: Uniplus status mapping handles numeric codes ---
test("L30: fiscal service maps Uniplus numeric statuses correctly", () => {
  const content = fs.readFileSync(path.join(PROJECT_ROOT, "backend", "lib", "fiscal", "fiscal-service.mjs"), "utf-8");
  assert.ok(content.includes('"2"'), "Must map status 2 (faturado)");
  assert.ok(content.includes('"6"'), "Must map status 6 (faturado)");
  assert.ok(content.includes('"3"'), "Must map status 3 (cancelado)");
  assert.ok(content.includes('"7"'), "Must map status 7 (parcial)");
});
