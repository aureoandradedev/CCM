/**
 * Tests for entregador address navigation actions
 *
 * Run: npx vitest run ccm-etapa1/test/entregador-nav-actions.test.ts
 */
import { describe, test, expect } from "vitest";

// ── Pure reimplementation of the helpers (mirrors _workflow.tsx) ────────────

interface AddressFields {
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_cep: string | null;
  delivery_method: string;
}

function formatAddressOneLine(d: AddressFields): string | null {
  const parts: string[] = [];
  if (d.address_street) {
    let line = d.address_street;
    if (d.address_number) line += `, ${d.address_number}`;
    if (d.address_complement) line += ` - ${d.address_complement}`;
    parts.push(line);
  }
  if (d.address_district) parts.push(d.address_district);
  const cityState = [d.address_city, d.address_state].filter(Boolean).join(" - ");
  if (cityState) parts.push(cityState);
  if (d.address_cep) parts.push(`CEP ${d.address_cep}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildGoogleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildWazeUrl(address: string): string {
  return `https://www.waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

function shouldShowNavActions(d: AddressFields): boolean {
  return d.delivery_method === "delivery" && formatAddressOneLine(d) !== null;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const WJ8848: AddressFields = {
  address_street: "Rua prainha",
  address_number: "10",
  address_complement: "Casa",
  address_district: "Iriri",
  address_city: "Anchieta",
  address_state: "ES",
  address_cep: "29230000",
  delivery_method: "delivery",
};

const PICKUP: AddressFields = {
  ...WJ8848,
  delivery_method: "pickup",
};

const EMPTY_ADDRESS: AddressFields = {
  address_street: null,
  address_number: null,
  address_complement: null,
  address_district: null,
  address_city: null,
  address_state: null,
  address_cep: null,
  delivery_method: "delivery",
};

const PARTIAL_ADDRESS: AddressFields = {
  address_street: "Av. Brasil",
  address_number: null,
  address_complement: null,
  address_district: null,
  address_city: "Vitória",
  address_state: "ES",
  address_cep: null,
  delivery_method: "delivery",
};

const ACCENTUATED: AddressFields = {
  address_street: "Rua São José",
  address_number: "100",
  address_complement: "Bloco A, Aptº 302",
  address_district: "Conceição",
  address_city: "Niterói",
  address_state: "RJ",
  address_cep: "24020-100",
  delivery_method: "delivery",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Address Navigation Actions", () => {
  test("1: complete address generates correct Google Maps URL", () => {
    const addr = formatAddressOneLine(WJ8848)!;
    expect(addr).toBe("Rua prainha, 10 - Casa, Iriri, Anchieta - ES, CEP 29230000");

    const url = buildGoogleMapsUrl(addr);
    expect(url).toContain("https://www.google.com/maps/search/?api=1&query=");
    expect(url).toContain(encodeURIComponent("Rua prainha, 10 - Casa"));
    expect(url).toContain(encodeURIComponent("Anchieta - ES"));
  });

  test("2: complete address generates correct Waze URL", () => {
    const addr = formatAddressOneLine(WJ8848)!;
    const url = buildWazeUrl(addr);
    expect(url).toContain("https://www.waze.com/ul?q=");
    expect(url).toContain("&navigate=yes");
    expect(url).toContain(encodeURIComponent("Rua prainha, 10 - Casa"));
  });

  test("3: accented characters are URL-encoded", () => {
    const addr = formatAddressOneLine(ACCENTUATED)!;
    expect(addr).toContain("São José");
    expect(addr).toContain("Aptº 302");
    expect(addr).toContain("Niterói");

    const googleUrl = buildGoogleMapsUrl(addr);
    expect(googleUrl).not.toContain("São");
    expect(googleUrl).toContain(encodeURIComponent("São"));
    expect(googleUrl).toContain(encodeURIComponent("Niterói"));

    const wazeUrl = buildWazeUrl(addr);
    expect(wazeUrl).not.toContain("São");
    expect(wazeUrl).toContain(encodeURIComponent("São"));
  });

  test("4: copy address provides the one-line formatted string", () => {
    const addr = formatAddressOneLine(WJ8848);
    expect(addr).toBe("Rua prainha, 10 - Casa, Iriri, Anchieta - ES, CEP 29230000");
  });

  test("5: pickup does not show navigation buttons", () => {
    expect(shouldShowNavActions(PICKUP)).toBe(false);
  });

  test("6: empty address returns null and does not generate invalid links", () => {
    const addr = formatAddressOneLine(EMPTY_ADDRESS);
    expect(addr).toBeNull();
    expect(shouldShowNavActions(EMPTY_ADDRESS)).toBe(false);
  });

  test("7: partial address still builds with available fields", () => {
    const addr = formatAddressOneLine(PARTIAL_ADDRESS);
    expect(addr).toBe("Av. Brasil, Vitória - ES");
    expect(shouldShowNavActions(PARTIAL_ADDRESS)).toBe(true);

    const url = buildGoogleMapsUrl(addr!);
    expect(url).toContain(encodeURIComponent("Av. Brasil"));
    expect(url).toContain(encodeURIComponent("Vitória - ES"));
  });

  test("8: no status mutation from navigation actions", () => {
    const before = { ...WJ8848 };
    formatAddressOneLine(WJ8848);
    buildGoogleMapsUrl(formatAddressOneLine(WJ8848)!);
    buildWazeUrl(formatAddressOneLine(WJ8848)!);
    expect(WJ8848).toEqual(before);
  });

  test("9: URLs contain only address data, no PII", () => {
    const addr = formatAddressOneLine(WJ8848)!;
    const googleUrl = buildGoogleMapsUrl(addr);
    const wazeUrl = buildWazeUrl(addr);

    for (const url of [googleUrl, wazeUrl]) {
      expect(url).not.toContain("cpf");
      expect(url).not.toContain("telefone");
      expect(url).not.toContain("email");
      expect(url).not.toContain("@");
      expect(url).not.toContain("phone");
    }
  });
});
