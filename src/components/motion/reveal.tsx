"use client";

import { useRef, type ComponentPropsWithoutRef, type ElementType } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { cn } from "@/lib/utils";

type RevealProps<T extends ElementType> = {
  as?: T;
  /** atraso entre filhos marcados com `data-reveal` (s) */
  stagger?: number;
  /** deslocamento inicial em px */
  y?: number;
  /** ponto do viewport que dispara (padrão: topo do bloco a 88% da tela) */
  start?: string;
  className?: string;
  children: React.ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

/**
 * Revela em cascata os filhos marcados com `data-reveal` quando o bloco entra
 * na tela. Roda uma vez só (interface não deve "brigar" com quem rola).
 * Com `prefers-reduced-motion` vira só um fade curto.
 */
export function Reveal<T extends ElementType = "div">({
  as,
  stagger = 0.06,
  y = 18,
  start = "top 88%",
  className,
  children,
  ...rest
}: RevealProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
      if (!targets.length) return;

      if (prefersReducedMotion()) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }

      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger,
          ease: "power3.out",
          overwrite: "auto",
          scrollTrigger: { trigger: root, start, once: true },
        },
      );
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} className={cn("[&_[data-reveal]]:opacity-0", className)} {...rest}>
      {children}
    </Tag>
  );
}
