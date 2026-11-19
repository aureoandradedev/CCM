import { Truck } from "lucide-react";

const WEEKDAYS_PT: Record<number, string> = {
  0: "domingo",
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
};

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = WEEKDAYS_PT[d.getDay()] ?? "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}, ${dd}/${mm}`;
}

export function DeliveryHint({ expectedAvailabilityDate, stockStatus }: { expectedAvailabilityDate?: string; stockStatus?: string }) {
  const today = new Date().toISOString().slice(0, 10);

  let label: string | null = null;
  if (expectedAvailabilityDate && expectedAvailabilityDate >= today) {
    label = `Retire ${formatShortDate(expectedAvailabilityDate)}`;
  } else if (stockStatus === "in_stock") {
    label = "Pronta entrega";
  }

  if (!label) return null;

  return (
    <p className="mt-1 flex items-center gap-1 text-[0.68rem] font-semibold text-brand-green">
      <Truck className="size-3" />
      {label}
    </p>
  );
}
