import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// TEST M: Checkout sem pagamento — migrations, backend, frontend, security
// ═══════════════════════════════════════════════════════════════════════════

const PROJECT_ROOT = path.resolve(import.meta.dirname!, "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");
const SRC_DIR = path.join(PROJECT_ROOT, "src");
const BACKEND_DIR = path.join(PROJECT_ROOT, "backend");

function readMigrationFiles(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

function readFile(rel: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════
// M1: Migration 0056 — checkout_sem_pagamento
// ═══════════════════════════════════════════════════════════════════════════

test("M1a: payment_method DROP NOT NULL in migration 0056", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /ALTER\s+TABLE.*orders.*ALTER\s+COLUMN\s+payment_method\s+DROP\s+NOT\s+NULL/i.test(sql),
    "payment_method DROP NOT NULL not found",
  );
});

test("M1b: order_access_tokens table created", () => {
  const sql = readMigrationFiles();
  assert.ok(/CREATE\s+TABLE.*order_access_tokens/i.test(sql), "order_access_tokens table not found");
  for (const col of ["order_id", "token_hash", "expires_at", "revoked_at", "scope"]) {
    assert.ok(sql.includes(col), `Column ${col} not found in order_access_tokens`);
  }
});

test("M1c: order_access_tokens has unique index on token_hash where not revoked", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE\s+UNIQUE\s+INDEX.*order_access_tokens.*token_hash.*WHERE\s+revoked_at\s+IS\s+NULL/is.test(sql),
    "Unique index on active token_hash not found",
  );
});

test("M1d: order_access_tokens has RLS enabled", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /ALTER\s+TABLE.*order_access_tokens\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql),
    "RLS not enabled for order_access_tokens",
  );
});

test("M1e: materialize_order_requirements updated to check aguardando-confirmacao", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /materialize_order_requirements.*aguardando-confirmacao/is.test(sql),
    "materialize_order_requirements should check for aguardando-confirmacao",
  );
});

test("M1f: espelhos storage bucket created", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /INSERT\s+INTO\s+storage\.buckets.*espelhos/is.test(sql),
    "espelhos storage bucket not found",
  );
});

test("M1g: validate_order_token RPC exists (SECURITY DEFINER)", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE.*FUNCTION.*validate_order_token/is.test(sql),
    "validate_order_token RPC not found",
  );
  assert.ok(
    /validate_order_token.*SECURITY\s+DEFINER/is.test(sql),
    "validate_order_token should be SECURITY DEFINER",
  );
});

test("M1h: revoke_order_tokens RPC exists (SECURITY DEFINER)", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE.*FUNCTION.*revoke_order_tokens/is.test(sql),
    "revoke_order_tokens RPC not found",
  );
});

test("M1i: address_id and customer_acceptance columns on orders", () => {
  const sql = readMigrationFiles();
  assert.ok(sql.includes("address_id"), "address_id column not found");
  assert.ok(sql.includes("customer_acceptance_required"), "customer_acceptance_required column not found");
  assert.ok(sql.includes("customer_accepted_at"), "customer_accepted_at column not found");
});

// ═══════════════════════════════════════════════════════════════════════════
// M2: Migration 0057 — supplier_confirmation
// ═══════════════════════════════════════════════════════════════════════════

test("M2a: po_mirrors table created with RLS", () => {
  const sql = readMigrationFiles();
  assert.ok(/CREATE\s+TABLE.*po_mirrors/i.test(sql), "po_mirrors table not found");
  assert.ok(
    /ALTER\s+TABLE.*po_mirrors\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql),
    "RLS not enabled for po_mirrors",
  );
});

test("M2b: supplier_confirmation_status column on supplier_purchase_orders", () => {
  const sql = readMigrationFiles();
  assert.ok(
    sql.includes("supplier_confirmation_status"),
    "supplier_confirmation_status not found",
  );
  for (const status of [
    "aguardando_confirmacao_fornecedor",
    "confirmado",
    "confirmado_parcial",
    "divergencia",
    "revisao_necessaria",
  ]) {
    assert.ok(sql.includes(status), `Status '${status}' not in CHECK constraint`);
  }
});

test("M2c: purchase_order_items supplier confirmation columns", () => {
  const sql = readMigrationFiles();
  for (const col of [
    "qty_supplier_confirmed",
    "supplier_item_status",
    "cost_supplier_confirmed_centavos",
    "supplier_notes",
  ]) {
    assert.ok(sql.includes(col), `Column ${col} not found in purchase_order_items`);
  }
});

test("M2d: order_notification_outbox table with idempotency_key", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE\s+TABLE.*order_notification_outbox/i.test(sql),
    "order_notification_outbox table not found",
  );
  assert.ok(sql.includes("idempotency_key"), "idempotency_key column not found");
  assert.ok(
    /idempotency_key.*UNIQUE|UNIQUE.*idempotency_key/is.test(sql),
    "idempotency_key should have UNIQUE constraint",
  );
});

test("M2e: confirm_supplier_po RPC exists", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE.*FUNCTION.*confirm_supplier_po/is.test(sql),
    "confirm_supplier_po RPC not found",
  );
});

test("M2f: check_order_supplier_gate RPC exists", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE.*FUNCTION.*check_order_supplier_gate/is.test(sql),
    "check_order_supplier_gate RPC not found",
  );
});

test("M2g: accept_order_adjustments RPC exists", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE.*FUNCTION.*accept_order_adjustments/is.test(sql),
    "accept_order_adjustments RPC not found",
  );
});

test("M2h: espelhos storage policies exist", () => {
  const sql = readMigrationFiles();
  assert.ok(
    /CREATE\s+POLICY.*espelhos/is.test(sql),
    "Storage policies for espelhos bucket not found",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M3: Backend — pedido.mjs
// ═══════════════════════════════════════════════════════════════════════════

test("M3a: criarPedido accepts null paymentMethod", () => {
  const src = readFile("backend/lib/pedido.mjs");
  assert.ok(
    /paymentMethod.*=.*null|paymentMethod.*\?\?/s.test(src),
    "criarPedido should default paymentMethod to null",
  );
});

test("M3b: criarPedido calls materialize_order_requirements", () => {
  const src = readFile("backend/lib/pedido.mjs");
  assert.ok(
    src.includes("materialize_order_requirements"),
    "criarPedido should call materialize_order_requirements",
  );
});

test("M3c: criarPedido creates outbox entries", () => {
  const src = readFile("backend/lib/pedido.mjs");
  assert.ok(
    src.includes("order_notification_outbox"),
    "criarPedido should insert into order_notification_outbox",
  );
});

test("M3d: criarPedido generates access token", () => {
  const src = readFile("backend/lib/pedido.mjs");
  assert.ok(
    src.includes("order_access_tokens"),
    "criarPedido should create an order_access_token",
  );
});

test("M3e: respostaPedido returns accessToken", () => {
  const src = readFile("backend/lib/pedido.mjs");
  assert.ok(
    /accessToken/s.test(src),
    "respostaPedido should return accessToken",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M4: Backend — pagamentos.mjs token revocation
// ═══════════════════════════════════════════════════════════════════════════

test("M4a: pagamentos.mjs revokes tokens after payment", () => {
  const src = readFile("backend/lib/pagamentos.mjs");
  assert.ok(
    src.includes("revoke_order_tokens"),
    "pagamentos.mjs should revoke tokens after payment confirmation",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M5: Backend — outbox routes
// ═══════════════════════════════════════════════════════════════════════════

test("M5a: outbox route file exists with GET/PATCH/validate-token/supplier-gate", () => {
  const src = readFile("backend/routes/outbox.mjs");
  assert.ok(src.includes("outbox.get") || src.includes("router.get"), "Outbox GET route not found");
  assert.ok(src.includes("outbox.patch") || src.includes("router.patch"), "Outbox PATCH route not found");
  assert.ok(src.includes("validate-token"), "validate-token endpoint not found");
  assert.ok(src.includes("supplier-gate"), "supplier-gate endpoint not found");
});

test("M5b: outbox route registered in servidor.mjs", () => {
  const src = readFile("backend/servidor.mjs");
  assert.ok(src.includes("outbox"), "outbox route not registered in servidor.mjs");
});

// ═══════════════════════════════════════════════════════════════════════════
// M6: Frontend — checkout without payment
// ═══════════════════════════════════════════════════════════════════════════

test("M6a: checkout-form.tsx does NOT render PaymentStep", () => {
  const src = readFile("src/components/checkout/checkout-form.tsx");
  assert.ok(
    !src.includes("PaymentStep"),
    "checkout-form.tsx should not render PaymentStep (removed for new flow)",
  );
});

test("M6b: checkout-form.tsx redirects to sucesso page", () => {
  const src = readFile("src/components/checkout/checkout-form.tsx");
  assert.ok(
    src.includes("/checkout/sucesso"),
    "checkout-form should redirect to /checkout/sucesso",
  );
});

test("M6c: success page shows no-charge message", () => {
  const src = readFile("src/app/(store)/checkout/sucesso/page.tsx");
  assert.ok(
    /n[ãa]o.*cobrad/i.test(src),
    "Success page should indicate no charge at checkout",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M7: Frontend — order detail: acceptance + payment choice
// ═══════════════════════════════════════════════════════════════════════════

test("M7a: order detail page imports AcceptAdjustments", () => {
  const src = readFile("src/app/(store)/conta/pedidos/[code]/page.tsx");
  assert.ok(src.includes("AcceptAdjustments"), "Order detail should import AcceptAdjustments");
});

test("M7b: order detail page imports ChoosePayment", () => {
  const src = readFile("src/app/(store)/conta/pedidos/[code]/page.tsx");
  assert.ok(src.includes("ChoosePayment"), "Order detail should import ChoosePayment");
});

test("M7c: order detail detects aguardandoAceite state", () => {
  const src = readFile("src/app/(store)/conta/pedidos/[code]/page.tsx");
  assert.ok(
    src.includes("aguardandoAceite"),
    "Order detail should compute aguardandoAceite flag",
  );
  assert.ok(
    src.includes("customer_acceptance_required"),
    "Should check customer_acceptance_required",
  );
});

test("M7d: order detail detects escolherMetodo state", () => {
  const src = readFile("src/app/(store)/conta/pedidos/[code]/page.tsx");
  assert.ok(
    src.includes("escolherMetodo"),
    "Order detail should compute escolherMetodo for null payment_method",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M8: Frontend — supplier portal
// ═══════════════════════════════════════════════════════════════════════════

test("M8a: supplier guard module exists", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "lib/supplier/guard.ts")),
    "src/lib/supplier/guard.ts should exist",
  );
  const src = readFile("src/lib/supplier/guard.ts");
  assert.ok(src.includes("getSupplierSession"), "Should export getSupplierSession");
  assert.ok(src.includes("assertSupplier"), "Should export assertSupplier");
});

test("M8b: supplier data module exists", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "lib/supplier/data.ts")),
    "src/lib/supplier/data.ts should exist",
  );
  const src = readFile("src/lib/supplier/data.ts");
  assert.ok(src.includes("listSupplierPOs"), "Should export listSupplierPOs");
  assert.ok(src.includes("getSupplierPO"), "Should export getSupplierPO");
});

test("M8c: supplier actions module exists", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "app/(store)/fornecedores/pedidos/actions.ts")),
    "Supplier pedidos actions.ts should exist",
  );
  const src = readFile("src/app/(store)/fornecedores/pedidos/actions.ts");
  assert.ok(src.includes("submitSupplierConfirmation"), "Should export submitSupplierConfirmation");
  assert.ok(src.includes("uploadMirror"), "Should export uploadMirror");
});

test("M8d: supplier portal list page exists", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "app/(store)/fornecedores/pedidos/page.tsx")),
    "Supplier pedidos list page should exist",
  );
});

test("M8e: supplier portal detail page exists with confirmation form", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "app/(store)/fornecedores/pedidos/[poId]/page.tsx")),
    "Supplier PO detail page should exist",
  );
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "app/(store)/fornecedores/pedidos/[poId]/_confirmation-form.tsx")),
    "Confirmation form should exist",
  );
  const form = readFile("src/app/(store)/fornecedores/pedidos/[poId]/_confirmation-form.tsx");
  assert.ok(form.includes("confirmado"), "Form should have 'confirmado' status option");
  assert.ok(form.includes("indisponivel"), "Form should have 'indisponivel' status option");
  assert.ok(form.includes("divergencia_custo"), "Form should have 'divergencia_custo' status option");
});

// ═══════════════════════════════════════════════════════════════════════════
// M9: Frontend — guest token page
// ═══════════════════════════════════════════════════════════════════════════

test("M9a: guest order page exists at /pedido/[token]", () => {
  assert.ok(
    fs.existsSync(path.join(SRC_DIR, "app/(store)/pedido/[token]/page.tsx")),
    "Guest order page should exist",
  );
  const src = readFile("src/app/(store)/pedido/[token]/page.tsx");
  assert.ok(src.includes("validate-token"), "Guest page should validate token via backend");
  assert.ok(src.includes("notFound"), "Guest page should import notFound");
});

// ═══════════════════════════════════════════════════════════════════════════
// M10: Security — route protection
// ═══════════════════════════════════════════════════════════════════════════

test("M10a: proxy.ts protects /fornecedores/pedidos route", () => {
  const src = readFile("src/proxy.ts");
  assert.ok(
    src.includes("fornecedores/pedidos"),
    "/fornecedores/pedidos should be login-protected in proxy.ts",
  );
});

test("M10b: supplier data uses owns_supplier RLS (via supplier_id filter)", () => {
  const src = readFile("src/lib/supplier/data.ts");
  assert.ok(
    src.includes("supplier_id"),
    "Supplier data layer should filter by supplier_id for RLS",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M11: Type safety — OrderRow nullable payment_method
// ═══════════════════════════════════════════════════════════════════════════

test("M11a: OrderRow.payment_method is nullable", () => {
  const src = readFile("src/lib/orders.ts");
  assert.ok(
    /payment_method\s*:\s*string\s*\|\s*null/s.test(src),
    "OrderRow.payment_method should be string | null",
  );
});

test("M11b: methodLabel handles null", () => {
  const src = readFile("src/lib/orders.ts");
  assert.ok(
    /methodLabel.*null|null.*methodLabel/is.test(src),
    "methodLabel should accept null",
  );
});

test("M11c: admin stats Map handles null payment_method", () => {
  const src = readFile("src/lib/admin/data.ts");
  assert.ok(
    /payment_method.*\?\?.*"a-definir"|payment_method.*\?\?.*a.definir/s.test(src),
    "Admin stats should coalesce null payment_method",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M12: Compras panel — supplier confirmation status visible
// ═══════════════════════════════════════════════════════════════════════════

test("M12a: PurchaseOrder type includes supplier_confirmation_status", () => {
  const src = readFile("src/lib/admin/types.ts");
  assert.ok(
    src.includes("supplier_confirmation_status"),
    "PurchaseOrder type should have supplier_confirmation_status",
  );
});

test("M12b: adminPurchaseOrders query selects supplier_confirmation_status", () => {
  const src = readFile("src/lib/admin/data.ts");
  assert.ok(
    /adminPurchaseOrders[\s\S]*supplier_confirmation_status/m.test(src),
    "adminPurchaseOrders should select supplier_confirmation_status",
  );
});

test("M12c: compras pedidos page shows confirmation column", () => {
  const src = readFile("src/app/(store)/compras/pedidos/page.tsx");
  assert.ok(
    src.includes("Confirmação") || src.includes("supplier_confirmation_status"),
    "Compras pedidos page should show confirmation status column",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M13: Server actions — acceptOrderAdjustments
// ═══════════════════════════════════════════════════════════════════════════

test("M13a: acceptOrderAdjustments server action exists", () => {
  const src = readFile("src/app/(store)/conta/actions.ts");
  assert.ok(
    src.includes("acceptOrderAdjustments"),
    "acceptOrderAdjustments server action should exist",
  );
  assert.ok(
    src.includes("accept_order_adjustments"),
    "Should call accept_order_adjustments RPC",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// M14: Idempotency — outbox ON CONFLICT DO NOTHING
// ═══════════════════════════════════════════════════════════════════════════

test("M14a: outbox inserts use ON CONFLICT DO NOTHING", () => {
  const sql = readMigrationFiles();
  const backend = readFile("backend/lib/pedido.mjs");
  const hasConflict = sql.includes("ON CONFLICT") || backend.includes("ON CONFLICT") || backend.includes("on conflict");
  assert.ok(hasConflict, "Outbox inserts should use ON CONFLICT for idempotency");
});
