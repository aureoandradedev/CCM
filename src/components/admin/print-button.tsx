"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="no-print mb-4 flex justify-end">
      <Button variant="navy" size="sm" onClick={() => window.print()}>
        <Printer /> Imprimir
      </Button>
    </div>
  );
}
