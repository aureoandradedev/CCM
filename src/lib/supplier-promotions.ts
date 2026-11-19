import { round2 } from "@/lib/pricing";

export interface SupplierPromotion {
  id: string;
  supplierId: string;
  discountPct: number;
  minMarginPct: number;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
}

export function applySupplierPromo(
  retailPrice: number,
  costCentavos: number,
  discountPct: number,
  minMarginPct: number,
): number {
  const discounted = round2(retailPrice * (1 - discountPct / 100));
  const floor = round2((costCentavos / 100) * (1 + minMarginPct / 100));
  return Math.max(discounted, floor);
}

export function isPromoActive(promo: SupplierPromotion, today?: string): boolean {
  if (!promo.active) return false;
  const d = today ?? new Date().toISOString().slice(0, 10);
  if (promo.validFrom && d < promo.validFrom) return false;
  if (promo.validTo && d > promo.validTo) return false;
  return true;
}
