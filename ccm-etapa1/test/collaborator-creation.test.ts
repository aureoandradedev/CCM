/**
 * Tests for collaborator creation flow (Auth Admin API: createUser with password)
 *
 * Validates:
 * 1: Admin creates entregador with password — succeeds, login-ready
 * 2: Admin creates recebedor — succeeds
 * 3: Non-admin blocked
 * 4: Invalid role blocked (customer, empty, random)
 * 5: Short/invalid password blocked
 * 6: Password confirmation mismatch blocked
 * 7: Existing email does not duplicate user
 * 8: Created user has email_confirmed + correct profile + role via RPC
 * 9: Password never stored in profile
 * 10: Deactivation via setCollaborator
 * 11: Role change via setCollaborator preserves user ID
 *
 * Run: npx vitest run ccm-etapa1/test/collaborator-creation.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Types ───────────────────────────────────────────────────────────────────

type UserRole = "customer" | "admin" | "compras" | "recebedor" | "operacao" | "entregador";

interface AuthUser {
  id: string;
  email: string;
  email_confirmed: boolean;
  user_metadata: Record<string, unknown>;
}

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

interface DB {
  auth_users: AuthUser[];
  profiles: Profile[];
}

// ── Pure simulation of Auth Admin API: createUser ───────────────────────────

const VALID_OP_ROLES: UserRole[] = ["admin", "compras", "recebedor", "operacao", "entregador"];
const MIN_PASSWORD_LENGTH = 6;

function simulateCreateUser(
  email: string,
  password: string,
  emailConfirm: boolean,
  userMetadata: Record<string, unknown>,
  db: DB,
): { user: AuthUser } | { error: string } {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = db.auth_users.find((u) => u.email === normalizedEmail);
  if (existing) {
    return { error: "A user with this email address has already been registered" };
  }

  const newId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user: AuthUser = {
    id: newId,
    email: normalizedEmail,
    email_confirmed: emailConfirm,
    user_metadata: userMetadata,
  };
  db.auth_users.push(user);

  // handle_new_user trigger creates profile with role='customer'
  db.profiles.push({
    id: newId,
    email: normalizedEmail,
    full_name: String(userMetadata.full_name ?? ""),
    role: "customer",
    is_active: true,
  });

  return { user };
}

// ── Pure simulation of admin_set_collaborator RPC ───────────────────────────

function simulateSetCollaboratorRPC(
  callerIsAdmin: boolean,
  profileId: string,
  newRole: string,
  isActive: boolean,
  db: DB,
): { ok: true } | { error: string } {
  if (!callerIsAdmin) {
    return { error: "Apenas administradores podem gerenciar colaboradores." };
  }
  if (!VALID_OP_ROLES.includes(newRole as UserRole)) {
    return { error: `Role inválida: ${newRole}.` };
  }
  const profile = db.profiles.find((p) => p.id === profileId);
  if (!profile) {
    return { error: "Perfil não encontrado." };
  }
  profile.role = newRole as UserRole;
  profile.is_active = isActive;
  return { ok: true };
}

// ── Composite: createCollaborator (mirrors the server action logic) ─────────

function simulateCreateCollaborator(
  callerIsAdmin: boolean,
  email: string,
  fullName: string,
  role: string,
  password: string,
  confirmPassword: string,
  db: DB,
): { ok: true; id: string; message: string } | { error: string } {
  if (!callerIsAdmin) {
    return { error: "Apenas administradores podem criar colaboradores." };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return { error: "E-mail inválido." };
  }

  if (!fullName.trim()) {
    return { error: "Nome completo é obrigatório." };
  }

  if (!VALID_OP_ROLES.includes(role as UserRole)) {
    return { error: `Função inválida: ${role}` };
  }

  if (!password) {
    return { error: "Senha é obrigatória." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  if (password !== confirmPassword) {
    return { error: "Senha e confirmação não conferem." };
  }

  // Check existing
  const existingProfile = db.profiles.find((p) => p.email === normalizedEmail);
  if (existingProfile) {
    return {
      error: "Já existe uma conta com este e-mail. Use a edição na tabela para alterar função ou status.",
    };
  }

  // Create via Auth Admin API
  const createResult = simulateCreateUser(
    normalizedEmail,
    password,
    true,
    { full_name: fullName.trim() },
    db,
  );

  if ("error" in createResult) {
    return { error: createResult.error };
  }

  // Set role via RPC
  const rpcResult = simulateSetCollaboratorRPC(true, createResult.user.id, role, true, db);
  if ("error" in rpcResult) {
    // Rollback: remove auth user
    db.auth_users = db.auth_users.filter((u) => u.id !== createResult.user.id);
    db.profiles = db.profiles.filter((p) => p.id !== createResult.user.id);
    return { error: `Erro ao definir função. Usuário não foi criado: ${rpcResult.error}` };
  }

  return {
    ok: true,
    id: createResult.user.id,
    message: "Colaborador criado. Ele já pode acessar com o e-mail e a senha definida.",
  };
}

// ── Simulation of listCollaborators ─────────────────────────────────────────

function simulateListCollaborators(db: DB): Profile[] {
  return db.profiles
    .filter((p) => VALID_OP_ROLES.includes(p.role))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshDB(): DB {
  return { auth_users: [], profiles: [] };
}

function dbWithCustomer(): DB {
  return {
    auth_users: [
      { id: "cust-001", email: "cliente@email.com", email_confirmed: true, user_metadata: { full_name: "Cliente Fulano" } },
    ],
    profiles: [
      { id: "cust-001", email: "cliente@email.com", full_name: "Cliente Fulano", role: "customer", is_active: true },
    ],
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("createCollaborator (Auth Admin API: createUser)", () => {
  test("1: admin creates entregador with password — succeeds, login-ready", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "entregador@test.com", "Carlos Entregador", "entregador", "Senha123!", "Senha123!", db,
    );
    expect("ok" in result).toBe(true);
    if ("ok" in result) {
      expect(result.id).toBeTruthy();
      expect(result.message).toContain("já pode acessar");
    }
    expect(db.auth_users).toHaveLength(1);
    expect(db.auth_users[0].email).toBe("entregador@test.com");
    expect(db.auth_users[0].email_confirmed).toBe(true);
    expect(db.auth_users[0].user_metadata.full_name).toBe("Carlos Entregador");
    expect(db.profiles).toHaveLength(1);
    expect(db.profiles[0].role).toBe("entregador");
    expect(db.profiles[0].is_active).toBe(true);
    expect(db.profiles[0].full_name).toBe("Carlos Entregador");
  });

  test("2: admin creates recebedor — succeeds", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "recebedor@test.com", "Ana Recebedora", "recebedor", "Senha456!", "Senha456!", db,
    );
    expect("ok" in result).toBe(true);
    expect(db.profiles[0].role).toBe("recebedor");
  });

  test("3: non-admin blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      false, "test@test.com", "Test", "entregador", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("administradores");
    expect(db.auth_users).toHaveLength(0);
  });

  test("4a: role customer blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "customer", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("inválida");
  });

  test("4b: empty role blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
  });

  test("4c: random role blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "superadmin", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
  });

  test("4d: empty email blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "", "Test", "compras", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("E-mail");
  });

  test("4e: invalid email format blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "not-an-email", "Test", "compras", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
  });

  test("4f: empty name blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "  ", "compras", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("Nome");
  });

  test("5a: empty password blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "compras", "", "", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("Senha");
  });

  test("5b: short password blocked (< 6 chars)", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "compras", "12345", "12345", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("mínimo");
  });

  test("6: password confirmation mismatch blocked", () => {
    const db = freshDB();
    const result = simulateCreateCollaborator(
      true, "test@test.com", "Test", "compras", "Senha123!", "OutraSenha!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("não conferem");
    expect(db.auth_users).toHaveLength(0);
  });

  test("7a: existing email (customer) — blocked, not silently promoted", () => {
    const db = dbWithCustomer();
    const result = simulateCreateCollaborator(
      true, "cliente@email.com", "Cliente Fulano", "operacao", "Senha123!", "Senha123!", db,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("Já existe");
    expect(db.profiles[0].role).toBe("customer");
  });

  test("7b: existing email does not create duplicate auth user", () => {
    const db = dbWithCustomer();
    simulateCreateCollaborator(
      true, "CLIENTE@EMAIL.COM", "New Name", "compras", "Senha123!", "Senha123!", db,
    );
    expect(db.auth_users).toHaveLength(1);
    expect(db.profiles).toHaveLength(1);
  });

  test("7c: email normalized (case-insensitive, trimmed)", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "  TEST@Test.COM  ", "Test User", "admin", "Senha123!", "Senha123!", db,
    );
    expect(db.auth_users[0].email).toBe("test@test.com");
    expect(db.profiles[0].email).toBe("test@test.com");
  });

  test("8: created user has email_confirmed + correct profile + role", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "new@test.com", "New User", "compras", "Senha123!", "Senha123!", db,
    );
    const auth = db.auth_users[0];
    const profile = db.profiles[0];

    expect(auth.email_confirmed).toBe(true);
    expect(auth.user_metadata.full_name).toBe("New User");

    expect(profile.id).toBe(auth.id);
    expect(profile.email).toBe("new@test.com");
    expect(profile.full_name).toBe("New User");
    expect(profile.role).toBe("compras");
    expect(profile.is_active).toBe(true);
  });

  test("9: password never stored in profile or auth user metadata", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "sec@test.com", "Sec User", "operacao", "SuperSecret99!", "SuperSecret99!", db,
    );
    const auth = db.auth_users[0];
    const profile = db.profiles[0];

    const authJson = JSON.stringify(auth);
    const profileJson = JSON.stringify(profile);

    expect(authJson).not.toContain("SuperSecret99!");
    expect(profileJson).not.toContain("SuperSecret99!");
    expect(auth.user_metadata).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("password");
  });
});

describe("setCollaborator (edit / deactivate)", () => {
  test("10: deactivation preserves profile", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "colab@test.com", "Colab", "entregador", "Senha123!", "Senha123!", db,
    );
    const id = db.profiles[0].id;

    const result = simulateSetCollaboratorRPC(true, id, "entregador", false, db);
    expect("ok" in result).toBe(true);
    expect(db.profiles[0].is_active).toBe(false);
    expect(db.profiles[0].full_name).toBe("Colab");
    expect(db.auth_users).toHaveLength(1);
  });

  test("11: role change preserves user ID", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "colab@test.com", "Colab", "entregador", "Senha123!", "Senha123!", db,
    );
    const id = db.profiles[0].id;

    const result = simulateSetCollaboratorRPC(true, id, "compras", true, db);
    expect("ok" in result).toBe(true);
    expect(db.profiles[0].id).toBe(id);
    expect(db.profiles[0].role).toBe("compras");
    expect(db.auth_users[0].id).toBe(id);
  });

  test("11b: non-admin cannot change role", () => {
    const db = freshDB();
    simulateCreateCollaborator(
      true, "colab@test.com", "Colab", "entregador", "Senha123!", "Senha123!", db,
    );
    const id = db.profiles[0].id;

    const result = simulateSetCollaboratorRPC(false, id, "admin", true, db);
    expect("error" in result).toBe(true);
    expect(db.profiles[0].role).toBe("entregador");
  });
});

describe("listCollaborators (separation)", () => {
  test("customers are excluded from collaborator listing", () => {
    const db = dbWithCustomer();
    simulateCreateCollaborator(
      true, "op@test.com", "Operador", "operacao", "Senha123!", "Senha123!", db,
    );

    const list = simulateListCollaborators(db);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("operacao");
    expect(list.find((p) => p.role === "customer")).toBeUndefined();
  });

  test("all operational roles appear in listing", () => {
    const db = freshDB();
    simulateCreateCollaborator(true, "a@t.com", "Admin User", "admin", "Senha123!", "Senha123!", db);
    simulateCreateCollaborator(true, "b@t.com", "Compras User", "compras", "Senha123!", "Senha123!", db);
    simulateCreateCollaborator(true, "c@t.com", "Recebedor User", "recebedor", "Senha123!", "Senha123!", db);
    simulateCreateCollaborator(true, "d@t.com", "Operacao User", "operacao", "Senha123!", "Senha123!", db);
    simulateCreateCollaborator(true, "e@t.com", "Entregador User", "entregador", "Senha123!", "Senha123!", db);

    const list = simulateListCollaborators(db);
    expect(list).toHaveLength(5);
    const roles = list.map((p) => p.role);
    expect(roles).toContain("admin");
    expect(roles).toContain("compras");
    expect(roles).toContain("recebedor");
    expect(roles).toContain("operacao");
    expect(roles).toContain("entregador");
  });
});
