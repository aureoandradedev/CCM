"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Botão "Filtrar" do celular: abre os mesmos filtros (links) numa gaveta lateral. */
export function MobileFilters({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const sp = useSearchParams();
  const key = `${pathname}?${sp.toString()}`;

  // fecha quando a URL muda (o cliente clicou num filtro): ajuste durante o render, sem efeito
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" className="h-10 lg:hidden" />}>
        <SlidersHorizontal />
        Filtrar
        {activeCount > 0 ? (
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-navy px-1.5 text-[0.7rem] font-bold text-white dark:bg-brand-yellow dark:text-brand-navy">
            {activeCount}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="left" className="w-[86vw] gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-brand-line px-5 py-4">
          <SheetTitle className="font-heading text-lg font-extrabold text-brand-navy dark:text-foreground">Filtrar produtos</SheetTitle>
          <SheetDescription>Os resultados atualizam ao escolher um filtro.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
