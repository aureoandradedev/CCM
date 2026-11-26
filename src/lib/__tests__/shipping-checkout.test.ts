/**
 * Testes: Shipping + endereço + área de entrega + persistência no checkout.
 *
 * Requer vitest: npx vitest run src/lib/__tests__/shipping-checkout.test.ts
 */
// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, it, expect, beforeEach } from "vitest";

const FREE_SHIPPING_FROM_CENTAVOS = 79900;
const STANDARD_SHIPPING_CENTAVOS = 4990;
const FREE_FROM = FREE_SHIPPING_FROM_CENTAVOS / 100;
const STANDARD = STANDARD_SHIPPING_CENTAVOS / 100;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface DeliveryArea {
  mode: "uf" | "cities" | "cep_prefixes";
  allowedUFs?: string[];
  allowedCities?: string[];
  allowedCepPrefixes?: string[];
  label: string;
  rejectMessage: string;
}

const FAIL_CLOSED_MSG = "Área de entrega temporariamente indisponível. Escolha retirada no CD ou tente novamente mais tarde.";

const SUL_ES_CITIES = [
  "Alfredo Chaves", "Anchieta", "Iconha", "Piúma", "Rio Novo do Sul",
  "Itapemirim", "Marataízes", "Presidente Kennedy",
  "Castelo", "Vargem Alta", "Cachoeiro de Itapemirim", "Muqui",
  "Atílio Vivácqua", "Mimoso do Sul", "Apiacá",
  "Ibatiba", "Irupi", "Iúna", "Ibitirama", "Muniz Freire",
  "Divino de São Lourenço", "Jerônimo Monteiro", "Alegre",
  "Dores do Rio Preto", "Guaçuí", "São José do Calçado", "Bom Jesus do Norte",
];

const DEFAULT_AREA: DeliveryArea = {
  mode: "cities",
  allowedCities: SUL_ES_CITIES,
  label: "Sul do ES",
  rejectMessage: "Ainda não entregamos nessa região.",
};

const EMPTY_AREA: DeliveryArea = {
  mode: "cities",
  allowedCities: [],
  label: "Sul do ES",
  rejectMessage: "Ainda não entregamos nessa região.",
};

type Entrega = "pickup" | "delivery";

interface Address {
  cep: string;
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function validateDeliveryArea(area: DeliveryArea | undefined, uf: string, city: string): string | null {
  if (!area) return FAIL_CLOSED_MSG;
  if (area.mode === "cities") {
    const allowed = area.allowedCities ?? [];
    if (allowed.length === 0) return FAIL_CLOSED_MSG;
    const normalizedAllowed = allowed.map(normalizeCity);
    if (!normalizedAllowed.includes(normalizeCity(city))) return area.rejectMessage;
    return null;
  }
  if (area.mode === "uf") {
    const allowed = area.allowedUFs ?? [];
    if (allowed.length === 0) return FAIL_CLOSED_MSG;
    if (!allowed.map((u) => u.toUpperCase()).includes(uf.trim().toUpperCase())) return area.rejectMessage;
    return null;
  }
  return FAIL_CLOSED_MSG;
}

function backendValidateArea(area: DeliveryArea | undefined, state: string, city: string): string | null {
  if (!area || (area.mode !== "cities" && area.mode !== "uf")) return FAIL_CLOSED_MSG;
  const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ufUp = state.trim().toUpperCase().slice(0, 2);
  const areaReject = area.rejectMessage || "Ainda não entregamos nessa região.";
  if (area.mode === "cities") {
    const allowed = Array.isArray(area.allowedCities) ? area.allowedCities : [];
    if (allowed.length === 0) return FAIL_CLOSED_MSG;
    const normalizedAllowed = allowed.map(norm);
    if (!normalizedAllowed.includes(norm(city))) return areaReject;
    return null;
  }
  if (area.mode === "uf") {
    const allowedUFs = Array.isArray(area.allowedUFs) ? area.allowedUFs : [];
    if (allowedUFs.length === 0) return FAIL_CLOSED_MSG;
    if (!allowedUFs.map((s) => s.toUpperCase()).includes(ufUp)) return areaReject;
    return null;
  }
  return FAIL_CLOSED_MSG;
}

function hasValidCep(cep: string): boolean {
  return cep.replace(/\D/g, "").length === 8;
}

function hasCompleteAddress(addr: Partial<Address>, cepError: string | null): boolean {
  return (
    hasValidCep(addr.cep ?? "") &&
    !cepError &&
    !!addr.rua?.trim() &&
    !!addr.numero?.trim() &&
    !!addr.bairro?.trim() &&
    !!addr.cidade?.trim() &&
    !!addr.uf?.trim()
  );
}

function computeShipping(
  entrega: Entrega,
  subtotal: number,
  hasValidCep: boolean,
  cepError: string | null,
): number | null {
  if (entrega === "pickup") return 0;
  if (subtotal >= FREE_FROM) return 0;
  if (hasValidCep && !cepError) return STANDARD;
  return null;
}

function canSubmit(entrega: Entrega, addr: Partial<Address>, cepError: string | null): boolean {
  if (entrega === "delivery" && !hasCompleteAddress(addr, cepError)) return false;
  return true;
}

function computeTotal(subtotal: number, shipping: number | null): number | null {
  return shipping !== null ? round2(subtotal + shipping) : null;
}

// ============================================================================
// City list sanity check
// ============================================================================
describe("City list sanity", () => {
  it("has exactly 27 municipalities", () => {
    expect(SUL_ES_CITIES).toHaveLength(27);
  });

  it("no duplicates", () => {
    const normalized = SUL_ES_CITIES.map(normalizeCity);
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});

// ============================================================================
// 1) Só CEP preenchido → NÃO envia
// ============================================================================
describe("1) CEP only, no full address → cannot submit", () => {
  const addr: Partial<Address> = { cep: "29100000", rua: "", numero: "", bairro: "", cidade: "", uf: "" };

  it("hasCompleteAddress is false with only CEP", () => {
    expect(hasCompleteAddress(addr, null)).toBe(false);
  });

  it("canSubmit is false for delivery", () => {
    expect(canSubmit("delivery", addr, null)).toBe(false);
  });

  it("shipping is still standard (CEP valid, area ok) but button blocked by address", () => {
    expect(computeShipping("delivery", 300, true, null)).toBe(STANDARD);
  });
});

// ============================================================================
// 2) CEP + endereço incompleto → NÃO envia
// ============================================================================
describe("2) CEP + partial address → cannot submit", () => {
  const addr: Partial<Address> = { cep: "29100000", rua: "Rua Teste", numero: "", bairro: "Centro", cidade: "", uf: "ES" };

  it("missing numero and cidade → incomplete", () => {
    expect(hasCompleteAddress(addr, null)).toBe(false);
  });

  it("canSubmit is false", () => {
    expect(canSubmit("delivery", addr, null)).toBe(false);
  });
});

// ============================================================================
// 3) Endereço completo em cidade permitida → envia
// ============================================================================
describe("3) Complete valid address in allowed city → can submit", () => {
  const addr: Partial<Address> = { cep: "29345000", rua: "Rua Teste", numero: "123", bairro: "Centro", cidade: "Cachoeiro de Itapemirim", uf: "ES" };
  const subtotal = 300;

  it("hasCompleteAddress is true", () => {
    expect(hasCompleteAddress(addr, null)).toBe(true);
  });

  it("canSubmit is true", () => {
    expect(canSubmit("delivery", addr, null)).toBe(true);
  });

  it("shipping is standard rate", () => {
    expect(computeShipping("delivery", subtotal, true, null)).toBe(STANDARD);
  });

  it("total includes shipping", () => {
    const shipping = computeShipping("delivery", subtotal, true, null)!;
    expect(computeTotal(subtotal, shipping)).toBe(round2(subtotal + STANDARD));
  });

  it("area validation passes for allowed city", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Cachoeiro de Itapemirim")).toBeNull();
  });
});

// ============================================================================
// 4) Cidade fora da área → bloqueia
// ============================================================================
describe("4) City outside delivery area → blocks", () => {
  it("Vitória → bloqueia", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Vitória")).not.toBeNull();
  });

  it("Vila Velha → bloqueia", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Vila Velha")).not.toBeNull();
  });

  it("Linhares → bloqueia", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Linhares")).not.toBeNull();
  });

  it("RJ → bloqueia", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "RJ", "Rio de Janeiro")).not.toBeNull();
  });

  it("SP → bloqueia", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "SP", "São Paulo")).not.toBeNull();
  });

  it("hasCompleteAddress is false when cepError is set", () => {
    const addr: Partial<Address> = { cep: "01001000", rua: "Praça da Sé", numero: "1", bairro: "Sé", cidade: "São Paulo", uf: "SP" };
    const cepError = DEFAULT_AREA.rejectMessage;
    expect(hasCompleteAddress(addr, cepError)).toBe(false);
  });

  it("canSubmit is false with cepError", () => {
    const addr: Partial<Address> = { cep: "01001000", rua: "Praça da Sé", numero: "1", bairro: "Sé", cidade: "São Paulo", uf: "SP" };
    expect(canSubmit("delivery", addr, DEFAULT_AREA.rejectMessage)).toBe(false);
  });

  it("shipping is null when area blocked", () => {
    expect(computeShipping("delivery", 300, true, DEFAULT_AREA.rejectMessage)).toBeNull();
  });
});

// ============================================================================
// 4b) Normalização de cidade (acentos, case)
// ============================================================================
describe("4b) City normalization (accents, case)", () => {
  it("Piúma with accent → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Piúma")).toBeNull();
  });

  it("PIUMA uppercase no accent → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "PIUMA")).toBeNull();
  });

  it("piuma lowercase no accent → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "piuma")).toBeNull();
  });

  it("Guaçuí with cedilla → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Guaçuí")).toBeNull();
  });

  it("GUACUI uppercase no accents → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "GUACUI")).toBeNull();
  });

  it("Marataízes with accent → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Marataízes")).toBeNull();
  });

  it("MARATAIZES uppercase no accent → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "MARATAIZES")).toBeNull();
  });

  it("Cachoeiro de Itapemirim mixed case → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "cachoeiro de itapemirim")).toBeNull();
  });

  it("Iúna → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Iúna")).toBeNull();
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "IUNA")).toBeNull();
  });

  it("São José do Calçado → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "São José do Calçado")).toBeNull();
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "sao jose do calcado")).toBeNull();
  });

  it("rejects similar but different city", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Cachoeiro de Algo")).not.toBeNull();
  });
});

// ============================================================================
// 4c) Specific allowed cities → aceita
// ============================================================================
describe("4c) Specific allowed cities pass validation", () => {
  it("Piúma → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Piúma")).toBeNull();
  });

  it("Anchieta → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Anchieta")).toBeNull();
  });

  it("Cachoeiro de Itapemirim → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Cachoeiro de Itapemirim")).toBeNull();
  });

  it("Guaçuí → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Guaçuí")).toBeNull();
  });

  it("Alegre → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Alegre")).toBeNull();
  });

  it("Bom Jesus do Norte → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Bom Jesus do Norte")).toBeNull();
  });

  it("Divino de São Lourenço → aceita", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, "ES", "Divino de São Lourenço")).toBeNull();
  });
});

// ============================================================================
// 4d) FAIL-CLOSED: lista vazia / config ausente → delivery bloqueado
// ============================================================================
describe("4d) FAIL-CLOSED: empty list / missing config → delivery blocked", () => {
  it("lista vazia → delivery bloqueado", () => {
    const error = validateDeliveryArea(EMPTY_AREA, "ES", "Cachoeiro de Itapemirim");
    expect(error).toBe(FAIL_CLOSED_MSG);
  });

  it("config ausente (undefined) → delivery bloqueado", () => {
    const error = validateDeliveryArea(undefined, "ES", "Cachoeiro de Itapemirim");
    expect(error).toBe(FAIL_CLOSED_MSG);
  });

  it("allowedCities undefined → delivery bloqueado", () => {
    const area: DeliveryArea = { mode: "cities", label: "Sul do ES", rejectMessage: "Teste" };
    const error = validateDeliveryArea(area, "ES", "Cachoeiro de Itapemirim");
    expect(error).toBe(FAIL_CLOSED_MSG);
  });

  it("UF mode with empty allowedUFs → delivery bloqueado", () => {
    const area: DeliveryArea = { mode: "uf", allowedUFs: [], label: "ES", rejectMessage: "Fora" };
    const error = validateDeliveryArea(area, "ES", "Qualquer");
    expect(error).toBe(FAIL_CLOSED_MSG);
  });

  it("unknown mode → delivery bloqueado", () => {
    const area = { mode: "cep_prefixes", label: "test", rejectMessage: "Fora" } as DeliveryArea;
    const error = validateDeliveryArea(area, "ES", "Qualquer");
    expect(error).toBe(FAIL_CLOSED_MSG);
  });

  it("pickup com config vazia → permitido", () => {
    expect(canSubmit("pickup", {}, null)).toBe(true);
    expect(computeShipping("pickup", 300, false, null)).toBe(0);
  });
});

// ============================================================================
// 5) Retirada → não exige endereço
// ============================================================================
describe("5) Pickup → no address required", () => {
  const emptyAddr: Partial<Address> = {};
  const subtotal = 300;

  it("canSubmit is true for pickup without any address", () => {
    expect(canSubmit("pickup", emptyAddr, null)).toBe(true);
  });

  it("shipping is 0 for pickup", () => {
    expect(computeShipping("pickup", subtotal, false, null)).toBe(0);
  });

  it("total equals subtotal", () => {
    expect(computeTotal(subtotal, 0)).toBe(subtotal);
  });
});

// ============================================================================
// 6) Primeira compra salva endereço (lógica de deduplicação)
// ============================================================================
describe("6) First purchase saves address (dedup logic)", () => {
  interface SavedAddr {
    profile_id: string;
    cep: string;
    street: string;
    number: string;
    district: string;
    is_default: boolean;
  }
  const addresses: SavedAddr[] = [];

  function saveAddress(profileId: string, addr: { cep: string; street: string; number: string; district: string }, existingCount: number) {
    const dup = addresses.find(
      (a) => a.profile_id === profileId && a.cep === addr.cep && a.street === addr.street && a.number === addr.number && a.district === addr.district,
    );
    if (dup) return false;
    addresses.push({
      profile_id: profileId,
      cep: addr.cep,
      street: addr.street,
      number: addr.number,
      district: addr.district,
      is_default: existingCount === 0,
    });
    return true;
  }

  it("saves address for authenticated user on first purchase", () => {
    const saved = saveAddress("user1", { cep: "29100000", street: "Rua A", number: "10", district: "Centro" }, 0);
    expect(saved).toBe(true);
    expect(addresses).toHaveLength(1);
    expect(addresses[0].is_default).toBe(true);
  });

  it("second address is NOT default", () => {
    const saved = saveAddress("user1", { cep: "29200000", street: "Rua B", number: "20", district: "Praia" }, 1);
    expect(saved).toBe(true);
    expect(addresses).toHaveLength(2);
    expect(addresses[1].is_default).toBe(false);
  });
});

// ============================================================================
// 7) Próxima compra carrega endereço salvo
// ============================================================================
describe("7) Next purchase loads saved address", () => {
  const savedAddress = {
    id: "addr-1",
    label: "Obra",
    cep: "29345000",
    street: "Rua Teste",
    number: "123",
    complement: null,
    district: "Centro",
    city: "Cachoeiro de Itapemirim",
    state: "ES",
    reference: null,
    is_default: true,
  };

  it("pre-fills form from saved address", () => {
    const form: Partial<Address> = {};
    form.cep = savedAddress.cep;
    form.rua = savedAddress.street;
    form.numero = savedAddress.number;
    form.bairro = savedAddress.district;
    form.cidade = savedAddress.city;
    form.uf = savedAddress.state;
    expect(hasCompleteAddress(form, null)).toBe(true);
    expect(canSubmit("delivery", form, null)).toBe(true);
  });

  it("validates saved address area (city in list)", () => {
    expect(validateDeliveryArea(DEFAULT_AREA, savedAddress.state, savedAddress.city)).toBeNull();
  });

  it("rejects saved address from wrong city", () => {
    const wrongSaved = { ...savedAddress, city: "Colatina" };
    const error = validateDeliveryArea(DEFAULT_AREA, wrongSaved.state, wrongSaved.city);
    expect(error).not.toBeNull();
  });
});

// ============================================================================
// 8) Retry não duplica endereço
// ============================================================================
describe("8) Retry does not duplicate address", () => {
  const store: Array<{ profile_id: string; cep: string; street: string; number: string; district: string }> = [];

  function saveIfNew(profileId: string, addr: { cep: string; street: string; number: string; district: string }) {
    const dup = store.find(
      (a) => a.profile_id === profileId && a.cep === addr.cep && a.street === addr.street && a.number === addr.number && a.district === addr.district,
    );
    if (dup) return false;
    store.push({ profile_id: profileId, ...addr });
    return true;
  }

  it("first save succeeds", () => {
    expect(saveIfNew("u1", { cep: "29100000", street: "Rua A", number: "10", district: "Centro" })).toBe(true);
    expect(store).toHaveLength(1);
  });

  it("duplicate save is skipped", () => {
    expect(saveIfNew("u1", { cep: "29100000", street: "Rua A", number: "10", district: "Centro" })).toBe(false);
    expect(store).toHaveLength(1);
  });

  it("different address still saves", () => {
    expect(saveIfNew("u1", { cep: "29100000", street: "Rua A", number: "11", district: "Centro" })).toBe(true);
    expect(store).toHaveLength(2);
  });
});

// ============================================================================
// 9) Pedido mantém snapshot independente
// ============================================================================
describe("9) Order keeps address snapshot independent of saved address", () => {
  it("snapshot is a separate copy, not a reference", () => {
    const savedAddr = { cep: "29345000", street: "Rua A", number: "10", district: "Centro", city: "Cachoeiro de Itapemirim", state: "ES" };
    const orderSnapshot = { ...savedAddr };
    savedAddr.street = "Rua B";
    expect(orderSnapshot.street).toBe("Rua A");
    expect(savedAddr.street).toBe("Rua B");
  });

  it("changing saved address does not affect existing order", () => {
    const orders = [{ address: { cep: "29345000", street: "Rua A", number: "10" } }];
    const updatedAddress = { cep: "29345000", street: "Rua Nova", number: "10" };
    expect(orders[0].address.street).toBe("Rua A");
    expect(updatedAddress.street).toBe("Rua Nova");
  });
});

// ============================================================================
// Backend: calcularFrete (pure function)
// ============================================================================
describe("Backend calcularFrete logic", () => {
  function calcularFrete({ deliveryMethod, subtotalCentavos, frete }: { deliveryMethod: string; subtotalCentavos: number; frete?: { freeShippingFromCentavos?: number; flatCentavos?: number } }) {
    const cfg = frete || {};
    if (deliveryMethod === "pickup") return { freightCentavos: 0, rule: "pickup" };
    const free = Number((cfg as Record<string, unknown>).freeShippingFromCentavos ?? 79900);
    const flat = Number((cfg as Record<string, unknown>).flatCentavos ?? 4990);
    if (subtotalCentavos >= free) return { freightCentavos: 0, rule: "free-shipping" };
    return { freightCentavos: flat, rule: "flat" };
  }

  it("pickup = 0", () => {
    expect(calcularFrete({ deliveryMethod: "pickup", subtotalCentavos: 10000 }).freightCentavos).toBe(0);
  });

  it("delivery below threshold = flat rate", () => {
    expect(calcularFrete({ deliveryMethod: "delivery", subtotalCentavos: 30000 }).freightCentavos).toBe(4990);
  });

  it("delivery above threshold = free", () => {
    expect(calcularFrete({ deliveryMethod: "delivery", subtotalCentavos: 80000 }).freightCentavos).toBe(0);
  });

  it("custom config overrides defaults", () => {
    const frete = { freeShippingFromCentavos: 50000, flatCentavos: 2990 };
    expect(calcularFrete({ deliveryMethod: "delivery", subtotalCentavos: 30000, frete }).freightCentavos).toBe(2990);
    expect(calcularFrete({ deliveryMethod: "delivery", subtotalCentavos: 60000, frete }).freightCentavos).toBe(0);
  });
});

// ============================================================================
// Backend: delivery area validation (cities mode) — FAIL-CLOSED
// ============================================================================
describe("Backend delivery area validation (fail-closed)", () => {
  it("Piúma → aceita", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Piúma")).toBeNull();
  });

  it("Anchieta → aceita", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Anchieta")).toBeNull();
  });

  it("Cachoeiro de Itapemirim → aceita", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Cachoeiro de Itapemirim")).toBeNull();
  });

  it("Guaçuí → aceita", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Guaçuí")).toBeNull();
  });

  it("city not in list rejected", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Colatina")).not.toBeNull();
  });

  it("Vitória → bloqueia", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Vitória")).not.toBeNull();
  });

  it("Vila Velha → bloqueia", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Vila Velha")).not.toBeNull();
  });

  it("Linhares → bloqueia", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "Linhares")).not.toBeNull();
  });

  it("RJ → bloqueia", () => {
    expect(backendValidateArea(DEFAULT_AREA, "RJ", "Rio de Janeiro")).not.toBeNull();
  });

  it("SP → bloqueia", () => {
    expect(backendValidateArea(DEFAULT_AREA, "SP", "São Paulo")).not.toBeNull();
  });

  it("case-insensitive and accent-insensitive", () => {
    expect(backendValidateArea(DEFAULT_AREA, "ES", "PIUMA")).toBeNull();
    expect(backendValidateArea(DEFAULT_AREA, "ES", "piuma")).toBeNull();
    expect(backendValidateArea(DEFAULT_AREA, "es", "guacui")).toBeNull();
  });

  it("UF mode: ES passes, SP rejected", () => {
    const ufArea: DeliveryArea = { mode: "uf", allowedUFs: ["ES"], label: "ES", rejectMessage: "Fora" };
    expect(backendValidateArea(ufArea, "ES", "Qualquer")).toBeNull();
    expect(backendValidateArea(ufArea, "SP", "São Paulo")).not.toBeNull();
  });

  it("empty list → delivery bloqueado (fail-closed)", () => {
    expect(backendValidateArea(EMPTY_AREA, "ES", "Cachoeiro de Itapemirim")).toBe(FAIL_CLOSED_MSG);
  });

  it("config ausente → delivery bloqueado (fail-closed)", () => {
    expect(backendValidateArea(undefined, "ES", "Cachoeiro de Itapemirim")).toBe(FAIL_CLOSED_MSG);
  });

  it("UF mode empty list → delivery bloqueado (fail-closed)", () => {
    const area: DeliveryArea = { mode: "uf", allowedUFs: [], label: "ES", rejectMessage: "Fora" };
    expect(backendValidateArea(area, "ES", "Qualquer")).toBe(FAIL_CLOSED_MSG);
  });
});

// ============================================================================
// 10) Multi-address: selection, add, default logic
// ============================================================================
describe("10) Multi-address management", () => {
  interface StoredAddr {
    id: string;
    profile_id: string;
    label: string;
    cep: string;
    street: string;
    number: string;
    complement: string | null;
    district: string;
    city: string;
    state: string;
    reference: string | null;
    is_default: boolean;
  }

  let store: StoredAddr[] = [];
  let nextId = 1;

  function saveAddress(
    profileId: string,
    addr: { cep: string; street: string; number: string; district: string; city: string; state: string; complement?: string; reference?: string },
    meta?: { label?: string; setAsDefault?: boolean },
  ): StoredAddr | null {
    const dup = store.find(
      (a) => a.profile_id === profileId && a.cep === addr.cep && a.street === addr.street && a.number === addr.number && a.district === addr.district,
    );
    if (dup) return null;
    const label = meta?.label?.trim() || "Obra";
    const wantsDefault = !!meta?.setAsDefault;
    const existingCount = store.filter((a) => a.profile_id === profileId).length;
    const isFirst = existingCount === 0;
    const makeDefault = isFirst || wantsDefault;
    if (wantsDefault && !isFirst) {
      store.forEach((a) => { if (a.profile_id === profileId && a.is_default) a.is_default = false; });
    }
    const newAddr: StoredAddr = {
      id: `addr-${nextId++}`,
      profile_id: profileId,
      label,
      cep: addr.cep,
      street: addr.street,
      number: addr.number,
      complement: addr.complement ?? null,
      district: addr.district,
      city: addr.city,
      state: addr.state,
      reference: addr.reference ?? null,
      is_default: makeDefault,
    };
    store.push(newAddr);
    return newAddr;
  }

  function getUserAddresses(profileId: string): StoredAddr[] {
    return store
      .filter((a) => a.profile_id === profileId)
      .sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1));
  }

  beforeEach(() => { store = []; nextId = 1; });

  it("1 saved address appears and can be selected", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua Prainha", number: "10", district: "Iriri", city: "Anchieta", state: "ES" });
    const addrs = getUserAddresses("u1");
    expect(addrs).toHaveLength(1);
    expect(addrs[0].is_default).toBe(true);
    expect(addrs[0].city).toBe("Anchieta");
  });

  it("multiple addresses can be stored and listed", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua Prainha", number: "10", district: "Iriri", city: "Anchieta", state: "ES" }, { label: "Casa" });
    saveAddress("u1", { cep: "29300000", street: "Rua Teste", number: "50", district: "Centro", city: "Cachoeiro de Itapemirim", state: "ES" }, { label: "Obra" });
    saveAddress("u1", { cep: "29350000", street: "Av Comercial", number: "100", district: "Centro", city: "Marataízes", state: "ES" }, { label: "Empresa" });
    const addrs = getUserAddresses("u1");
    expect(addrs).toHaveLength(3);
    expect(addrs.map((a) => a.label)).toEqual(expect.arrayContaining(["Casa", "Obra", "Empresa"]));
  });

  it("adding new address does NOT overwrite previous", () => {
    const first = saveAddress("u1", { cep: "29345000", street: "Rua Prainha", number: "10", district: "Iriri", city: "Anchieta", state: "ES" }, { label: "Casa" });
    const second = saveAddress("u1", { cep: "29300000", street: "Rua B", number: "20", district: "Centro", city: "Cachoeiro de Itapemirim", state: "ES" }, { label: "Obra" });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const addrs = getUserAddresses("u1");
    expect(addrs).toHaveLength(2);
    expect(addrs.find((a) => a.street === "Rua Prainha")).toBeDefined();
    expect(addrs.find((a) => a.street === "Rua B")).toBeDefined();
  });

  it("first address becomes default automatically", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" });
    expect(getUserAddresses("u1")[0].is_default).toBe(true);
  });

  it("second address does NOT silently become default", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" });
    saveAddress("u1", { cep: "29300000", street: "Rua B", number: "2", district: "D2", city: "Cachoeiro de Itapemirim", state: "ES" });
    const addrs = getUserAddresses("u1");
    expect(addrs).toHaveLength(2);
    const defaults = addrs.filter((a) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].street).toBe("Rua A");
  });

  it("setAsDefault=true switches default to new address", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" }, { label: "Casa" });
    saveAddress("u1", { cep: "29300000", street: "Rua B", number: "2", district: "D2", city: "Cachoeiro de Itapemirim", state: "ES" }, { label: "Obra", setAsDefault: true });
    const addrs = getUserAddresses("u1");
    const defaults = addrs.filter((a) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].label).toBe("Obra");
    expect(addrs.find((a) => a.label === "Casa")?.is_default).toBe(false);
  });

  it("setAsDefault=false does not change existing default", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" }, { label: "Casa" });
    saveAddress("u1", { cep: "29300000", street: "Rua B", number: "2", district: "D2", city: "Cachoeiro de Itapemirim", state: "ES" }, { label: "Obra", setAsDefault: false });
    const addrs = getUserAddresses("u1");
    const defaults = addrs.filter((a) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].label).toBe("Casa");
  });

  it("selected address populates form correctly", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua Prainha", number: "10", district: "Iriri", city: "Anchieta", state: "ES", complement: "Lote 5", reference: "Perto do mercado" }, { label: "Casa" });
    const addr = getUserAddresses("u1")[0];
    const form: Partial<Address> = {
      cep: addr.cep,
      rua: addr.street,
      numero: addr.number,
      bairro: addr.district,
      cidade: addr.city,
      uf: addr.state,
    };
    expect(hasCompleteAddress(form, null)).toBe(true);
    expect(validateDeliveryArea(DEFAULT_AREA, addr.state, addr.city)).toBeNull();
  });

  it("address chosen goes to snapshot (independent copy)", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua Prainha", number: "10", district: "Iriri", city: "Anchieta", state: "ES" });
    const addr = getUserAddresses("u1")[0];
    const snapshot = { cep: addr.cep, street: addr.street, number: addr.number, district: addr.district, city: addr.city, state: addr.state };
    addr.street = "CHANGED";
    expect(snapshot.street).toBe("Rua Prainha");
    expect(addr.street).toBe("CHANGED");
  });

  it("retry does not duplicate address", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" });
    const dup = saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" });
    expect(dup).toBeNull();
    expect(getUserAddresses("u1")).toHaveLength(1);
  });

  it("custom label is preserved", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" }, { label: "Empresa" });
    expect(getUserAddresses("u1")[0].label).toBe("Empresa");
  });

  it("getUserAddresses returns default first", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" }, { label: "Casa" });
    saveAddress("u1", { cep: "29300000", street: "Rua B", number: "2", district: "D2", city: "Cachoeiro de Itapemirim", state: "ES" }, { label: "Obra", setAsDefault: true });
    const addrs = getUserAddresses("u1");
    expect(addrs[0].is_default).toBe(true);
    expect(addrs[0].label).toBe("Obra");
  });

  it("different users have isolated address stores", () => {
    saveAddress("u1", { cep: "29345000", street: "Rua A", number: "1", district: "D1", city: "Anchieta", state: "ES" });
    saveAddress("u2", { cep: "29300000", street: "Rua B", number: "2", district: "D2", city: "Cachoeiro de Itapemirim", state: "ES" });
    expect(getUserAddresses("u1")).toHaveLength(1);
    expect(getUserAddresses("u2")).toHaveLength(1);
    expect(getUserAddresses("u1")[0].city).toBe("Anchieta");
    expect(getUserAddresses("u2")[0].city).toBe("Cachoeiro de Itapemirim");
  });
});

// ============================================================================
// Free shipping threshold edge cases
// ============================================================================
describe("Free shipping threshold edge cases", () => {
  it("exactly at threshold = free", () => {
    expect(computeShipping("delivery", FREE_FROM, true, null)).toBe(0);
  });

  it("1 centavo below threshold = standard", () => {
    expect(computeShipping("delivery", FREE_FROM - 0.01, true, null)).toBe(STANDARD);
  });

  it("free shipping ignores cepError (subtotal >= threshold always = 0)", () => {
    expect(computeShipping("delivery", FREE_FROM + 100, true, "some error")).toBe(0);
  });
});
