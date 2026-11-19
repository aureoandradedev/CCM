"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

const WEEKDAYS_PT: Record<number, string> = {
  0: "domingo",
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
};

interface Props {
  expectedAvailabilityDate?: string;
  globalCutoff?: string;
}

export function CutoffHint({ expectedAvailabilityDate, globalCutoff = "12:30" }: Props) {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!expectedAvailabilityDate) return;
    const today = new Date().toISOString().slice(0, 10);
    if (expectedAvailabilityDate < today) return;

    const avDate = new Date(expectedAvailabilityDate + "T12:00:00");
    const dayName = WEEKDAYS_PT[avDate.getDay()] ?? "";
    const dd = String(avDate.getDate()).padStart(2, "0");
    const mm = String(avDate.getMonth() + 1).padStart(2, "0");

    setHint(`Compre até ${globalCutoff} para retirar ${dayName}, ${dd}/${mm}`);
  }, [expectedAvailabilityDate, globalCutoff]);

  if (!hint) return null;

  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-orange">
      <Clock className="size-3.5" />
      {hint}
    </p>
  );
}
