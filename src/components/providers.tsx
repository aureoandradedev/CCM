"use client";

import { useEffect } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCartStore } from "@/lib/cart/store";

export function Providers({ children }: { children: React.ReactNode }) {
  // O carrinho persiste no localStorage; hidratamos SÓ no cliente para o HTML
  // do servidor (carrinho vazio) bater com o primeiro render.
  useEffect(() => {
    void useCartStore.persist.rehydrate();
  }, []);

  return (
    <TooltipProvider delay={300}>
      {children}
      <Toaster position="bottom-right" closeButton richColors offset={24} mobileOffset={{ bottom: 84 }} />
    </TooltipProvider>
  );
}
