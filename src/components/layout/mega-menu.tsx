"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronRight, Menu } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Category } from "@/types/catalog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const TONE: Record<NonNullable<Category["tone"]>, string> = {
  yellow: "bg-brand-yellow-soft text-brand-navy",
  orange: "bg-brand-orange-soft text-brand-orange",
  navy: "bg-brand-navy/8 text-brand-navy",
  green: "bg-brand-green-soft text-brand-green",
  blue: "bg-brand-blue/10 text-brand-blue",
  red: "bg-brand-red/10 text-brand-red",
  slate: "bg-muted text-brand-ink-soft",
};

/**
 * "Todos os departamentos": painel mega-menu (Telhanorte/Obramax). Abre no
 * hover com pequeno atraso e no clique/teclado; lista à esquerda, subcategorias
 * e imagem da categoria ativa à direita.
 */
export function MegaMenu({ categories }: { categories: Category[] }) {
  const id = useId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [activeSlug, setActiveSlug] = useState(categories[0]?.slug ?? "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const active = categories.find((c) => c.slug === activeSlug) ?? categories[0];

  // fecha ao navegar (ajuste de estado durante o render, sem efeito)
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className={cn(
          "press inline-flex h-11 items-center gap-2.5 rounded-xl bg-brand-yellow px-4 font-heading text-[0.95rem] font-bold text-brand-navy transition-colors hover:bg-brand-yellow-2",
          open && "bg-brand-yellow-2",
        )}
      >
        <Menu className="size-5" />
        <span className="whitespace-nowrap xl:hidden">Departamentos</span>
        <span className="hidden whitespace-nowrap xl:inline">Todos os departamentos</span>
      </button>

      <div
        id={`${id}-panel`}
        role="region"
        aria-label="Departamentos"
        hidden={!open}
        className={cn(
          "absolute top-[calc(100%+10px)] left-0 z-50 w-[min(960px,calc(100vw-2rem))] origin-top-left overflow-hidden rounded-2xl border border-brand-line bg-popover shadow-[var(--shadow-float)]",
          open && "animate-in fade-in-0 zoom-in-[0.98] duration-150",
        )}
      >
        <div className="grid grid-cols-[280px_1fr]">
          <ul className="max-h-[70vh] overflow-y-auto border-r border-brand-line bg-muted/40 py-2" role="list">
            {categories.map((c) => {
              const isActive = c.slug === active?.slug;
              return (
                <li key={c.slug}>
                  <Link
                    href={`/categoria/${c.slug}`}
                    onMouseEnter={() => setActiveSlug(c.slug)}
                    onFocus={() => setActiveSlug(c.slug)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-brand-ink transition-colors",
                      isActive ? "bg-card text-brand-navy shadow-[inset_3px_0_0_var(--ccm-yellow)] dark:text-foreground" : "hover:bg-card/70",
                    )}
                  >
                    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", TONE[c.tone ?? "slate"])}>
                      <Icon name={c.icon} className="size-4" />
                    </span>
                    <span className="flex-1">{c.name}</span>
                    <ChevronRight className={cn("size-4 text-brand-ink-soft transition-transform", isActive && "translate-x-0.5 text-brand-navy")} />
                  </Link>
                </li>
              );
            })}
          </ul>

          {active ? (
            <div className="grid grid-cols-[1fr_220px] gap-6 p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">{active.name}</p>
                <p className="mt-1 text-sm text-brand-ink-soft">{active.description}</p>
                <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1">
                  {active.children.map((s) => (
                    <li key={s.slug}>
                      <Link
                        href={`/categoria/${active.slug}?sub=${s.slug}`}
                        className="block rounded-md px-2 py-1.5 text-sm text-brand-ink transition-colors hover:bg-brand-yellow-soft hover:text-brand-navy"
                      >
                        {s.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/categoria/${active.slug}`}
                  className="mt-4 inline-flex items-center gap-1.5 font-heading text-sm font-bold text-brand-navy hover:underline dark:text-foreground"
                >
                  Ver tudo em {active.name}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
              <Link href={`/categoria/${active.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-xl bg-muted" aria-hidden="true" tabIndex={-1}>
                {active.image ? (
                  <Image src={active.image} alt="" fill sizes="220px" className="object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-105" />
                ) : null}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-navy/80 to-transparent p-3 font-heading text-sm font-bold text-white">{active.name}</span>
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
