"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { assignShipmentDriver, type ActionResult } from "@/app/admin/actions";
import { inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

export type DriverOption = { id: string; full_name: string | null; email: string };

export function DriverAssignSection({
  shipmentId,
  currentDriverId,
  drivers,
}: {
  shipmentId: string;
  currentDriverId: string | null;
  drivers: DriverOption[];
}) {
  const [pending, start] = useTransition();

  const currentDriver = currentDriverId
    ? drivers.find((d) => d.id === currentDriverId)
    : null;

  const handleAssign = (fd: FormData) => {
    start(async () => {
      const r = await assignShipmentDriver({} as ActionResult, fd);
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
    });
  };

  if (drivers.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
          Nenhum entregador ativo cadastrado.
        </p>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Cadastre um colaborador com função &quot;Entregador&quot; em{" "}
          <Link href="/admin/colaboradores" className="underline font-semibold hover:no-underline">
            Colaboradores
          </Link>.
        </p>
      </div>
    );
  }

  return (
    <form action={handleAssign} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <label className="block text-xs font-semibold text-brand-ink min-w-0 flex-1">
        <span className="flex items-center gap-1 mb-1">
          <UserPlus className="size-3.5" /> Entregador
        </span>
        <select name="driverId" defaultValue={currentDriverId ?? ""} className={inputCls}>
          <option value="" disabled>Selecione...</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name || d.email}
            </option>
          ))}
        </select>
      </label>
      {currentDriver && (
        <p className="text-xs text-brand-ink-soft w-full">
          Atual: <span className="font-semibold">{currentDriver.full_name || currentDriver.email}</span>
        </p>
      )}
      {currentDriverId && !currentDriver && (
        <p className="text-xs text-amber-600 w-full">
          Atribuído a usuário sem role entregador ativo.
        </p>
      )}
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {currentDriverId ? "Reatribuir" : "Atribuir"}
      </Button>
    </form>
  );
}
