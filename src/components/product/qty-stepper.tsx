"use client";

import { Minus, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface QtyStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: "sm" | "md" | "lg";
  /** ao chegar em 0 mostra a lixeira no botão de menos */
  allowZero?: boolean;
  className?: string;
  label?: string;
}

const SIZES = {
  sm: { box: "h-8", btn: "w-8", input: "w-10 text-sm", icon: "size-3.5" },
  md: { box: "h-10", btn: "w-10", input: "w-12 text-base", icon: "size-4" },
  lg: { box: "h-12", btn: "w-12", input: "w-14 text-lg", icon: "size-4" },
};

/** Controle de quantidade: alvo de toque de 40px+, digitação livre, sem "pulos". */
export function QtyStepper({ value, onChange, min = 1, max = 9999, step = 1, size = "md", allowZero = false, className, label = "Quantidade" }: QtyStepperProps) {
  const s = SIZES[size];
  const lower = allowZero ? 0 : min;
  const atLower = value <= lower;
  const atUpper = value >= max;

  const set = (n: number) => onChange(Math.max(lower, Math.min(max, Math.floor(n))));

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-lg border border-brand-navy/20 bg-card text-brand-navy dark:text-foreground",
        s.box,
        className,
      )}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={cn("press inline-flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent", s.btn)}
        onClick={() => set(value - step)}
        disabled={atLower && !allowZero}
        aria-label={allowZero && value <= step ? "Remover" : "Diminuir quantidade"}
      >
        {allowZero && value <= step ? <Trash2 className={cn(s.icon, "text-brand-red")} /> : <Minus className={s.icon} />}
      </button>
      <input
        type="number"
        inputMode="numeric"
        className={cn("border-x border-brand-navy/15 bg-transparent text-center font-heading font-bold tabular-nums outline-none [appearance:textfield] focus-visible:bg-brand-yellow-soft [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", s.input)}
        value={value}
        min={lower}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(n);
        }}
        onBlur={(e) => {
          if (!e.target.value) set(min);
        }}
        aria-label={label}
      />
      <button
        type="button"
        className={cn("press inline-flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent", s.btn)}
        onClick={() => set(value + step)}
        disabled={atUpper}
        aria-label="Aumentar quantidade"
      >
        <Plus className={s.icon} />
      </button>
    </div>
  );
}
