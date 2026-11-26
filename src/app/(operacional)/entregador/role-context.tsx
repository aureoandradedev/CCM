"use client";

import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext(false);

export function EntregadorRoleProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  return <Ctx value={isAdmin}>{children}</Ctx>;
}

export function useIsAdminInEntregador(): boolean {
  return useContext(Ctx);
}
