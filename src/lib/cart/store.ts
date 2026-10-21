import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Product } from "@/types/catalog";
import { MAX_QTY_PER_LINE, computeCartTotals, type CartTotals } from "@/lib/pricing";

/**
 * Carrinho do CCM.
 *
 * Mesma filosofia do `cart-mrcd` do Multigiro: UM único ponto de gravação,
 * limite de quantidade aplicado aqui (vale para todo chamador) e evento de
 * mudança para quem quiser ouvir. Diferença: guardamos um "snapshot" do
 * produto na linha (nome, imagem, preços) para a gaveta renderizar sem
 * precisar do catálogo. O servidor revalida preços na hora do pedido.
 */

export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  image: string;
  unit: string;
  packInfo?: string;
  retailPrice: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  supplierId?: string;
  supplierName?: string;
  leadTimeDays?: number;
  qty: number;
  addedAt: number;
}

export interface CartState {
  lines: Record<string, CartLine>;
  isOpen: boolean;
  /** id do último produto adicionado (para destaque na gaveta) */
  lastAddedId: string | null;
  add: (product: Product, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  increment: (productId: string, step?: number) => void;
  decrement: (productId: string, step?: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
}

export const CART_STORAGE_KEY = "ccm_cart_v1";

function clampQty(qty: number): number {
  const n = Math.floor(Number(qty) || 0);
  return Math.max(0, Math.min(MAX_QTY_PER_LINE, n));
}

function toLine(product: Product, qty: number): CartLine {
  return {
    productId: product.id,
    slug: product.slug,
    name: product.name,
    image: product.images[0] ?? "",
    unit: product.unit,
    packInfo: product.packInfo,
    retailPrice: product.retailPrice,
    wholesalePrice: product.wholesalePrice,
    wholesaleMinQty: product.wholesaleMinQty,
    supplierId: product.supplier?.id,
    leadTimeDays: product.supplier?.leadTimeDays,
    qty,
    addedAt: Date.now(),
  };
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: {},
      isOpen: false,
      lastAddedId: null,

      add: (product, qty = 1) =>
        set((state) => {
          const current = state.lines[product.id];
          const next = clampQty((current?.qty ?? 0) + qty);
          if (next <= 0) return state;
          return {
            lines: {
              ...state.lines,
              [product.id]: current
                ? { ...current, qty: next, retailPrice: product.retailPrice, wholesalePrice: product.wholesalePrice, wholesaleMinQty: product.wholesaleMinQty }
                : toLine(product, next),
            },
            lastAddedId: product.id,
          };
        }),

      setQty: (productId, qty) =>
        set((state) => {
          const current = state.lines[productId];
          if (!current) return state;
          const next = clampQty(qty);
          if (next <= 0) {
            const rest = { ...state.lines };
            delete rest[productId];
            return { lines: rest };
          }
          return { lines: { ...state.lines, [productId]: { ...current, qty: next } } };
        }),

      increment: (productId, step = 1) =>
        set((state) => {
          const current = state.lines[productId];
          if (!current) return state;
          return {
            lines: { ...state.lines, [productId]: { ...current, qty: clampQty(current.qty + step) } },
          };
        }),

      decrement: (productId, step = 1) =>
        set((state) => {
          const current = state.lines[productId];
          if (!current) return state;
          const next = clampQty(current.qty - step);
          if (next <= 0) {
            const rest = { ...state.lines };
            delete rest[productId];
            return { lines: rest };
          }
          return { lines: { ...state.lines, [productId]: { ...current, qty: next } } };
        }),

      remove: (productId) =>
        set((state) => {
          if (!state.lines[productId]) return state;
          const rest = { ...state.lines };
          delete rest[productId];
          return { lines: rest };
        }),

      clear: () => set({ lines: {}, lastAddedId: null }),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setOpen: (open) => set({ isOpen: open }),
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ lines: state.lines }),
      // Hidratação manual no cliente (Providers) para não divergir do SSR.
      skipHydration: true,
    },
  ),
);

/* ----------------------------- seletores ----------------------------- */

export function selectLines(state: CartState): CartLine[] {
  return Object.values(state.lines).sort((a, b) => a.addedAt - b.addedAt);
}

export function selectCount(state: CartState): number {
  let n = 0;
  for (const line of Object.values(state.lines)) n += line.qty;
  return n;
}

export function selectLineQty(productId: string) {
  return (state: CartState): number => state.lines[productId]?.qty ?? 0;
}

export function selectTotals(state: CartState): CartTotals {
  return computeCartTotals(Object.values(state.lines));
}
