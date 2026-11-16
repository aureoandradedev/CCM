import { formatBRL } from "@/lib/utils/format";

/** Defaults — used as fallback when no admin config exists. */
export const FREE_SHIPPING_FROM_CENTAVOS = 79900;
export const STANDARD_SHIPPING_CENTAVOS = 4990;

export function shippingFromSettings(frete: { freeShippingFromCentavos: number; flatCentavos: number }) {
  const freeFrom = frete.freeShippingFromCentavos / 100;
  return {
    freeShippingFrom: freeFrom,
    freeShippingLabel: formatBRL(freeFrom),
    standardShipping: frete.flatCentavos / 100,
  };
}
