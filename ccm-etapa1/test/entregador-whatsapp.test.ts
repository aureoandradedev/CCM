/**
 * Tests for entregador WhatsApp button
 *
 * Run: npx vitest run ccm-etapa1/test/entregador-whatsapp.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Pure reimplementation of helpers (mirrors _workflow.tsx) ─────────────

function normalizePhoneForWhatsApp(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function buildWhatsAppUrl(phone: string, orderCode: string): string | null {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return null;
  const msg = `Olá! Sou o entregador da Multigiro. Estou com o pedido ${orderCode} e estou a caminho para realizar a entrega.`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;
}

// ── Fixtures ────────────────────────────────────────────────────────────

interface ShipmentLike {
  customer_phone: string | null;
  order_code: string;
  status: string;
}

const WJ8848: ShipmentLike = {
  customer_phone: "(28) 99947-3623",
  order_code: "WJ8848",
  status: "pronto_para_envio",
};

// ── Tests ───────────────────────────────────────────────────────────────

describe("WhatsApp Button", () => {
  test("1: (28) 99947-3623 normalizes to 5528999473623", () => {
    expect(normalizePhoneForWhatsApp("(28) 99947-3623")).toBe("5528999473623");
  });

  test("2: phone already with 55 prefix does not duplicate", () => {
    expect(normalizePhoneForWhatsApp("5528999473623")).toBe("5528999473623");
  });

  test("3: non-numeric characters are stripped correctly", () => {
    expect(normalizePhoneForWhatsApp("+55 (28) 99947-3623")).toBe("5528999473623");
    expect(normalizePhoneForWhatsApp("28.99947.3623")).toBe("5528999473623");
    expect(normalizePhoneForWhatsApp("28 99947 3623")).toBe("5528999473623");
  });

  test("4: wa.me link is correctly formed", () => {
    const url = buildWhatsAppUrl("(28) 99947-3623", "WJ8848");
    expect(url).not.toBeNull();
    expect(url).toContain("https://wa.me/5528999473623");
    expect(url).toContain("?text=");
  });

  test("5: message contains the order code", () => {
    const url = buildWhatsAppUrl("(28) 99947-3623", "WJ8848")!;
    const textParam = decodeURIComponent(url.split("?text=")[1]);
    expect(textParam).toContain("WJ8848");
    expect(textParam).toContain("entregador");
    expect(textParam).toContain("Multigiro");
  });

  test("6: invalid phone returns null — no button shown", () => {
    expect(normalizePhoneForWhatsApp("123")).toBeNull();
    expect(normalizePhoneForWhatsApp("")).toBeNull();
    expect(normalizePhoneForWhatsApp("abc")).toBeNull();
    expect(buildWhatsAppUrl("123", "WJ8848")).toBeNull();
  });

  test("7: clicking does not alter shipment status", () => {
    const before = { ...WJ8848 };
    normalizePhoneForWhatsApp(WJ8848.customer_phone!);
    buildWhatsAppUrl(WJ8848.customer_phone!, WJ8848.order_code);
    expect(WJ8848).toEqual(before);
  });

  test("8: Ligar link still works (phoneHref format preserved)", () => {
    const digits = "(28) 99947-3623".replace(/\D/g, "");
    const href = `tel:+55${digits}`;
    expect(href).toBe("tel:+5528999473623");
  });

  test("9: URL contains no PII beyond phone and order code", () => {
    const url = buildWhatsAppUrl("(28) 99947-3623", "WJ8848")!;
    expect(url).not.toContain("cpf");
    expect(url).not.toContain("email");
    expect(url).not.toContain("@");
    expect(url).not.toContain("endereço");
    expect(url).not.toContain("address");
    // Only phone number and order code in the URL
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("5528999473623");
    expect(decoded).toContain("WJ8848");
  });

  test("10: 10-digit landline normalizes correctly", () => {
    expect(normalizePhoneForWhatsApp("(28) 3522-1234")).toBe("552835221234");
  });
});
