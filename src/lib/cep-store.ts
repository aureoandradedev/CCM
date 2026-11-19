const KEY = "ccm_cep";

export function getSavedCep(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveCep(cep: string): void {
  try {
    if (cep && cep.length >= 8) {
      localStorage.setItem(KEY, cep);
    }
  } catch {
    // ignore
  }
}
