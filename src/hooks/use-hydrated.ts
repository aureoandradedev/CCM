"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** true só depois da hidratação no cliente (evita divergir do HTML do servidor). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
