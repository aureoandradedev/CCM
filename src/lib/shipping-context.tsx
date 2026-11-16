"use client";

import { createContext, useContext } from "react";
import { FREE_SHIPPING_FROM_CENTAVOS, STANDARD_SHIPPING_CENTAVOS } from "./shipping";
import { formatBRL } from "./utils/format";

export interface ShippingConfig {
  freeShippingFrom: number;
  freeShippingLabel: string;
  standardShipping: number;
}

function build(freeCentavos: number, flatCentavos: number): ShippingConfig {
  const freeFrom = freeCentavos / 100;
  return {
    freeShippingFrom: freeFrom,
    freeShippingLabel: formatBRL(freeFrom),
    standardShipping: flatCentavos / 100,
  };
}

const ShippingCtx = createContext<ShippingConfig>(
  build(FREE_SHIPPING_FROM_CENTAVOS, STANDARD_SHIPPING_CENTAVOS),
);

export function ShippingProvider({
  freeShippingFromCentavos = FREE_SHIPPING_FROM_CENTAVOS,
  standardShippingCentavos = STANDARD_SHIPPING_CENTAVOS,
  children,
}: {
  freeShippingFromCentavos?: number;
  standardShippingCentavos?: number;
  children: React.ReactNode;
}) {
  const config = build(freeShippingFromCentavos, standardShippingCentavos);
  return <ShippingCtx value={config}>{children}</ShippingCtx>;
}

export function useShippingConfig(): ShippingConfig {
  return useContext(ShippingCtx);
}
