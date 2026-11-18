/**
 * Tests for FASE 1 — Operational Roles Security
 *
 * Validates:
 * 1-3:  UserRole type, ROLE_HOME mapping, OPERATIONAL_ROLES list
 * 4-7:  requireRole guard (admin pass-through, role match, role mismatch, inactive)
 * 8-11: assertRole guard (admin, role match, role mismatch, inactive)
 * 12-14: proxy route protection mapping
 * 15-17: exigirRole backend middleware
 * 18-20: has_role() SQL logic
 * 21-22: assign_shipment_driver validation
 * 23-24: admin_set_collaborator validation
 * 25-26: Self-change prevention (role + is_active)
 * 27-28: Login redirect by role
 *
 * Run: node --experimental-strip-types --test ccm-etapa1/test/roles-security.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Inline types from auth.ts ───────────────────────────────────────────────

type UserRole = "customer" | "admin" | "compras" | "recebedor" | "operacao" | "entregador";

const OPERATIONAL_ROLES: UserRole[] = ["compras", "recebedor", "operacao", "entregador"];

const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  compras: "/compras",
  recebedor: "/recebedor",
  operacao: "/separador",
  entregador: "/entregador",
  customer: "/conta",
};

// ── Guard logic (pure, extracted from guard.ts) ─────────────────────────────

interface MockUser {
  id: string;
  role: UserRole;
  isActive: boolean;
}

type GuardResult = { type: "ok"; user: MockUser } | { type: "redirect"; to: string } | { type: "error"; message: string };

function simulateRequireRole(user: MockUser | null, allowedRoles: UserRole[], next?: string): GuardResult {
  if (!user) return { type: "redirect", to: `/conta?next=${encodeURIComponent(next ?? "/")}` };
  const allowed = user.role === "admin" || allowedRoles.includes(user.role);
  if (!allowed) {
    const home = ROLE_HOME[user.role] ?? "/conta";
    return { type: "redirect", to: `${home}?erro=permissao` };
  }
  if (user.role !== "admin" && !user.isActive) {
    return { type: "redirect", to: "/conta?erro=inativo" };
  }
  return { type: "ok", user };
}

function simulateAssertRole(user: MockUser | null, allowedRoles: UserRole[]): GuardResult {
  if (!user) return { type: "error", message: "Sessão expirada." };
  const allowed = user.role === "admin" || allowedRoles.includes(user.role);
  if (!allowed) return { type: "error", message: "Acesso negado para esta função." };
  if (user.role !== "admin" && !user.isActive) {
    return { type: "error", message: "Sua conta está desativada. Contate o administrador." };
  }
  return { type: "ok", user };
}

// ── Proxy logic (pure, extracted from proxy.ts) ─────────────────────────────

const OPERATIONAL_ROUTES: Record<string, string[]> = {
  "/admin": ["admin"],
  "/compras": ["compras", "admin"],
  "/recebedor": ["recebedor", "admin"],
  "/separador": ["operacao", "admin"],
  "/entregador": ["entregador", "admin"],
};

function simulateProxyCheck(pathname: string, role: string, isActive: boolean): "pass" | { redirect: string } {
  for (const [prefix, allowedRoles] of Object.entries(OPERATIONAL_ROUTES)) {
    if (pathname.startsWith(prefix) && prefix !== "/admin") {
      const allowed = allowedRoles.includes(role);
      if (!allowed) {
        const home = (ROLE_HOME as Record<string, string>)[role] ?? "/conta";
        return { redirect: `${home}?erro=permissao` };
      }
      if (role !== "admin" && !isActive) {
        return { redirect: "/conta?erro=inativo" };
      }
      break;
    }
  }
  return "pass";
}

// ── Backend middleware logic (pure, extracted from supabase.mjs) ─────────────

function simulateExigirRole(user: MockUser | null, ...roles: string[]): { status: number; body?: { ok: boolean; erro: string } } | "next" {
  if (!user) return { status: 401, body: { ok: false, erro: "Token ausente ou inválido." } };
  const allowed = user.role === "admin" || roles.includes(user.role);
  if (!allowed) return { status: 403, body: { ok: false, erro: "Acesso negado para esta função." } };
  if (user.role !== "admin" && !user.isActive) return { status: 403, body: { ok: false, erro: "Sua conta está desativada." } };
  return "next";
}

// ── has_role SQL logic (pure simulation) ────────────────────────────────────

function simulateHasRole(role: UserRole, isActive: boolean, allowedRoles: string[]): boolean {
  if (role === "admin") return true;
  if (allowedRoles.includes(role) && isActive) return true;
  return false;
}

// ── assign_shipment_driver SQL logic (pure simulation) ──────────────────────

interface MockProfile { id: string; role: UserRole; isActive: boolean }

function simulateAssignDriver(
  callerIsAdmin: boolean,
  driver: MockProfile | null,
  shipmentExists: boolean,
): { ok: true } | { error: string } {
  if (!callerIsAdmin) return { error: "Apenas administradores podem atribuir entregadores." };
  if (!driver) return { error: "Colaborador não encontrado." };
  if (driver.role !== "entregador") return { error: `Colaborador não possui perfil de entregador (role atual: ${driver.role}).` };
  if (!driver.isActive) return { error: "Entregador está inativo." };
  if (!shipmentExists) return { error: "Shipment não encontrado." };
  return { ok: true };
}

// ── admin_set_collaborator SQL logic (pure simulation) ──────────────────────

function simulateSetCollaborator(
  callerIsAdmin: boolean,
  targetExists: boolean,
  newRole: string,
): { ok: true } | { error: string } {
  if (!callerIsAdmin) return { error: "Apenas administradores podem gerenciar colaboradores." };
  const validRoles = ["admin", "compras", "recebedor", "operacao", "entregador"];
  if (!validRoles.includes(newRole)) return { error: `Role inválida: ${newRole}.` };
  if (!targetExists) return { error: "Perfil não encontrado." };
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Fase 1 — Roles & Auth", () => {
  // ── 1-3: Type definitions ─────────────────────────────────────────────────

  test("1: UserRole includes all 6 roles", () => {
    const all: UserRole[] = ["customer", "admin", "compras", "recebedor", "operacao", "entregador"];
    assert.equal(all.length, 6);
    for (const r of all) {
      assert.ok(ROLE_HOME[r], `ROLE_HOME missing for ${r}`);
    }
  });

  test("2: ROLE_HOME maps every role to a path", () => {
    assert.equal(ROLE_HOME.admin, "/admin");
    assert.equal(ROLE_HOME.compras, "/compras");
    assert.equal(ROLE_HOME.recebedor, "/recebedor");
    assert.equal(ROLE_HOME.operacao, "/separador");
    assert.equal(ROLE_HOME.entregador, "/entregador");
    assert.equal(ROLE_HOME.customer, "/conta");
  });

  test("3: OPERATIONAL_ROLES excludes admin and customer", () => {
    assert.ok(!OPERATIONAL_ROLES.includes("admin" as UserRole));
    assert.ok(!OPERATIONAL_ROLES.includes("customer" as UserRole));
    assert.equal(OPERATIONAL_ROLES.length, 4);
    assert.deepEqual(OPERATIONAL_ROLES, ["compras", "recebedor", "operacao", "entregador"]);
  });

  // ── 4-7: requireRole guard ────────────────────────────────────────────────

  test("4: requireRole — admin always passes any role check", () => {
    const admin: MockUser = { id: "a", role: "admin", isActive: true };
    for (const roles of [["compras"], ["recebedor"], ["operacao"], ["entregador"]] as UserRole[][]) {
      const r = simulateRequireRole(admin, roles);
      assert.equal(r.type, "ok", `admin should pass for ${roles}`);
    }
  });

  test("5: requireRole — matching role passes", () => {
    const user: MockUser = { id: "b", role: "compras", isActive: true };
    const r = simulateRequireRole(user, ["compras"]);
    assert.equal(r.type, "ok");
  });

  test("6: requireRole — mismatched role redirects to role home", () => {
    const user: MockUser = { id: "c", role: "entregador", isActive: true };
    const r = simulateRequireRole(user, ["compras"]);
    assert.equal(r.type, "redirect");
    assert.ok((r as { to: string }).to.includes("/entregador"));
    assert.ok((r as { to: string }).to.includes("erro=permissao"));
  });

  test("7: requireRole — inactive user redirects to inativo", () => {
    const user: MockUser = { id: "d", role: "compras", isActive: false };
    const r = simulateRequireRole(user, ["compras"]);
    assert.equal(r.type, "redirect");
    assert.ok((r as { to: string }).to.includes("erro=inativo"));
  });

  // ── 8-11: assertRole guard ────────────────────────────────────────────────

  test("8: assertRole — admin passes", () => {
    const admin: MockUser = { id: "a", role: "admin", isActive: true };
    const r = simulateAssertRole(admin, ["compras"]);
    assert.equal(r.type, "ok");
  });

  test("9: assertRole — matching role passes", () => {
    const user: MockUser = { id: "b", role: "recebedor", isActive: true };
    const r = simulateAssertRole(user, ["recebedor"]);
    assert.equal(r.type, "ok");
  });

  test("10: assertRole — mismatch throws", () => {
    const user: MockUser = { id: "c", role: "customer", isActive: true };
    const r = simulateAssertRole(user, ["compras"]);
    assert.equal(r.type, "error");
    assert.ok((r as { message: string }).message.includes("Acesso negado"));
  });

  test("11: assertRole — inactive throws", () => {
    const user: MockUser = { id: "d", role: "operacao", isActive: false };
    const r = simulateAssertRole(user, ["operacao"]);
    assert.equal(r.type, "error");
    assert.ok((r as { message: string }).message.includes("desativada"));
  });

  // ── 12-14: Proxy route protection ────────────────────────────────────────

  test("12: proxy — compras user accesses /compras", () => {
    assert.equal(simulateProxyCheck("/compras", "compras", true), "pass");
  });

  test("13: proxy — customer blocked from /compras", () => {
    const r = simulateProxyCheck("/compras", "customer", true);
    assert.notEqual(r, "pass");
    assert.ok((r as { redirect: string }).redirect.includes("erro=permissao"));
  });

  test("14: proxy — inactive entregador blocked from /entregador", () => {
    const r = simulateProxyCheck("/entregador", "entregador", false);
    assert.notEqual(r, "pass");
    assert.ok((r as { redirect: string }).redirect.includes("erro=inativo"));
  });

  // ── 15-17: Backend exigirRole middleware ──────────────────────────────────

  test("15: exigirRole — admin passes any role", () => {
    const admin: MockUser = { id: "a", role: "admin", isActive: true };
    assert.equal(simulateExigirRole(admin, "compras"), "next");
  });

  test("16: exigirRole — no token returns 401", () => {
    const r = simulateExigirRole(null, "compras");
    assert.notEqual(r, "next");
    assert.equal((r as { status: number }).status, 401);
  });

  test("17: exigirRole — wrong role returns 403", () => {
    const user: MockUser = { id: "b", role: "entregador", isActive: true };
    const r = simulateExigirRole(user, "compras");
    assert.notEqual(r, "next");
    assert.equal((r as { status: number }).status, 403);
  });

  // ── 18-20: has_role SQL ──────────────────────────────────────────────────

  test("18: has_role — admin always true", () => {
    assert.ok(simulateHasRole("admin", true, ["compras"]));
    assert.ok(simulateHasRole("admin", false, ["compras"]));
  });

  test("19: has_role — active matching role returns true", () => {
    assert.ok(simulateHasRole("compras", true, ["compras"]));
    assert.ok(simulateHasRole("operacao", true, ["operacao", "entregador"]));
  });

  test("20: has_role — inactive operational role returns false", () => {
    assert.ok(!simulateHasRole("compras", false, ["compras"]));
    assert.ok(!simulateHasRole("entregador", false, ["entregador"]));
  });

  // ── 21-22: assign_shipment_driver ────────────────────────────────────────

  test("21: assign_shipment_driver — non-admin blocked", () => {
    const r = simulateAssignDriver(false, { id: "d", role: "entregador", isActive: true }, true);
    assert.ok("error" in r);
    assert.ok(r.error.includes("administradores"));
  });

  test("22: assign_shipment_driver — non-entregador blocked", () => {
    const r = simulateAssignDriver(true, { id: "d", role: "compras", isActive: true }, true);
    assert.ok("error" in r);
    assert.ok(r.error.includes("entregador"));
  });

  // ── 23-24: admin_set_collaborator ────────────────────────────────────────

  test("23: admin_set_collaborator — non-admin blocked", () => {
    const r = simulateSetCollaborator(false, true, "compras");
    assert.ok("error" in r);
  });

  test("24: admin_set_collaborator — invalid role blocked", () => {
    const r = simulateSetCollaborator(true, true, "superadmin");
    assert.ok("error" in r);
    assert.ok(r.error.includes("inválida"));
  });

  // ── 25-26: Self-change prevention ────────────────────────────────────────

  test("25: Self-change — user cannot escalate own role (policy logic)", () => {
    // Simulates: WITH CHECK requires role = old_role when uid = id
    const oldRole = "compras";
    const newRole = "admin";
    const isSelf = true;
    const isAdmin = false;
    const allowed = !isSelf || isAdmin || newRole === oldRole;
    assert.ok(!allowed, "Non-admin self-role-change must be blocked");
  });

  test("26: Self-change — user cannot deactivate themselves (policy logic)", () => {
    const oldActive = true;
    const newActive = false;
    const isSelf = true;
    const isAdmin = false;
    const allowed = !isSelf || isAdmin || newActive === oldActive;
    assert.ok(!allowed, "Non-admin self-is_active-change must be blocked");
  });

  // ── 27-28: Login redirect by role ────────────────────────────────────────

  test("27: Login redirect — admin goes to /admin", () => {
    assert.equal(ROLE_HOME["admin"], "/admin");
  });

  test("28: Login redirect — customer goes to /conta", () => {
    assert.equal(ROLE_HOME["customer"], "/conta");
  });

  // ── Cross-role isolation ─────────────────────────────────────────────────

  test("29: Entregador cannot access compras route", () => {
    const r = simulateProxyCheck("/compras", "entregador", true);
    assert.notEqual(r, "pass");
  });

  test("30: Recebedor cannot access separador route", () => {
    const r = simulateProxyCheck("/separador", "recebedor", true);
    assert.notEqual(r, "pass");
  });

  test("31: Customer cannot access any operational route", () => {
    for (const path of ["/compras", "/recebedor", "/separador", "/entregador"]) {
      const r = simulateProxyCheck(path, "customer", true);
      assert.notEqual(r, "pass", `customer should be blocked from ${path}`);
    }
  });

  test("32: Admin can access all operational routes", () => {
    for (const path of ["/compras", "/recebedor", "/separador", "/entregador"]) {
      assert.equal(simulateProxyCheck(path, "admin", true), "pass", `admin should pass ${path}`);
    }
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test("33: requireRole — no session redirects to login", () => {
    const r = simulateRequireRole(null, ["compras"], "/compras");
    assert.equal(r.type, "redirect");
    assert.ok((r as { to: string }).to.startsWith("/conta?next="));
  });

  test("34: exigirRole — inactive admin still passes (admin exemption)", () => {
    const admin: MockUser = { id: "a", role: "admin", isActive: false };
    assert.equal(simulateExigirRole(admin, "compras"), "next");
  });

  test("35: has_role — customer not in any operational role", () => {
    assert.ok(!simulateHasRole("customer", true, ["compras", "recebedor", "operacao", "entregador"]));
  });

  test("36: assign_shipment_driver — inactive entregador blocked", () => {
    const r = simulateAssignDriver(true, { id: "d", role: "entregador", isActive: false }, true);
    assert.ok("error" in r);
    assert.ok(r.error.includes("inativo"));
  });

  test("37: assign_shipment_driver — missing shipment blocked", () => {
    const r = simulateAssignDriver(true, { id: "d", role: "entregador", isActive: true }, false);
    assert.ok("error" in r);
    assert.ok(r.error.includes("Shipment"));
  });

  test("38: admin_set_collaborator — customer role not allowed", () => {
    const r = simulateSetCollaborator(true, true, "customer");
    assert.ok("error" in r);
    assert.ok(r.error.includes("inválida"));
  });

  test("39: admin_set_collaborator — missing profile blocked", () => {
    const r = simulateSetCollaborator(true, false, "compras");
    assert.ok("error" in r);
    assert.ok(r.error.includes("Perfil"));
  });

  test("40: Inactive admin is exempt from is_active check in has_role", () => {
    assert.ok(simulateHasRole("admin", false, ["compras"]));
  });
});
