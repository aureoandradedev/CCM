"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";

import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { INTRO_STORAGE_KEY } from "@/lib/intro";

/**
 * Abertura do site (uma vez por sessão): o mascote, de costas, dá duas
 * marteladas, vira, levanta o braço e o "CCM" surge com "Central de Compras
 * Multigiro" embaixo. Depois a tela some e o site aparece.
 *
 * - 8 quadros em /brand/intro (fatiados da sprite sheet, pés alinhados)
 * - GSAP timeline; qualquer clique, toque ou tecla pula
 * - `prefers-reduced-motion`: só o quadro final + nome, sem coreografia
 * - o script inline do layout (next/script beforeInteractive) esconde
 *   `.intro-overlay` antes da pintura para quem já viu não ver nem um piscar
 */

const FRAMES = Array.from({ length: 8 }, (_, i) => `/brand/intro/frame-${i + 1}.webp`);
const LETTERS = ["C", "C", "M"];

/* (quadro, instante em s). 1 = braço erguido, 2 = martelada, 3 = martelo baixo,
   4 = virando, 5 = de lado, 6 = de frente, 7 = erguendo o braço, 8 = apresentando */
const SEQUENCE: [frame: number, at: number][] = [
  [1, 0],
  [2, 0.3],
  [1, 0.62],
  [2, 0.92],
  [3, 1.25],
  [4, 1.55],
  [5, 1.85],
  [6, 2.1],
  [7, 2.35],
  [8, 2.6],
];
const STRIKES = [0.3, 0.92];
const TEXT_AT = 2.75;

export function IntroLoader() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let seen = false;
    try {
      seen = sessionStorage.getItem(INTRO_STORAGE_KEY) === "1";
    } catch {}

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
      } catch {}
      document.documentElement.style.removeProperty("overflow");
      setDone(true);
    };

    if (seen) {
      // já viu nesta sessão: some sem animar (fora do corpo do efeito)
      const id = window.requestAnimationFrame(finish);
      return () => window.cancelAnimationFrame(id);
    }

    document.documentElement.style.overflow = "hidden";

    const frames = Array.from(root.querySelectorAll<HTMLImageElement>("[data-frame]"));
    const showFrame = (n: number) => {
      for (let i = 0; i < frames.length; i++) frames[i].style.visibility = i === n - 1 ? "visible" : "hidden";
    };

    const ctx = gsap.context(() => {}, root);
    let cancelled = false;

    const skip = () => {
      if (finished) return;
      ctx.add(() => {
        gsap.to(root, { autoAlpha: 0, duration: 0.25, ease: "power2.in", overwrite: true, onComplete: finish });
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    };
    root.addEventListener("click", skip);
    window.addEventListener("keydown", onKey);

    const start = () => {
      if (cancelled) return;
      ctx.add(() => {
        const stage = root.querySelector<HTMLElement>("[data-stage]");
        const mascot = root.querySelector<HTMLElement>("[data-mascot]");
        const spark = root.querySelector<HTMLElement>("[data-spark]");
        const letters = root.querySelectorAll<HTMLElement>("[data-letter]");
        const bar = root.querySelector<HTMLElement>("[data-bar]");
        const sub = root.querySelector<HTMLElement>("[data-sub]");
        const progress = root.querySelector<HTMLElement>("[data-progress]");

        if (prefersReducedMotion()) {
          showFrame(8);
          gsap.set([letters, bar, sub], { autoAlpha: 1 });
          gsap.timeline({ onComplete: finish }).to(root, { autoAlpha: 0, duration: 0.3, delay: 1.1 });
          return;
        }

        const tl = gsap.timeline({ defaults: { ease: "power3.out" }, onComplete: finish });
        if (process.env.NODE_ENV !== "production") {
          // depuração: `__ccmIntro.pause(2.1)` no console para inspecionar um instante
          (window as unknown as { __ccmIntro?: gsap.core.Timeline }).__ccmIntro = tl;
        }

        // entrada do mascote
        showFrame(1);
        tl.fromTo(mascot, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, 0);

        // troca de quadros como tweens de duração zero (funciona ao pular/rebobinar)
        for (const [frame, at] of SEQUENCE) {
          tl.set(frames, { visibility: (i: number) => (i === frame - 1 ? "visible" : "hidden") }, at);
        }

        // marteladas: pequeno tranco + faísca
        for (const at of STRIKES) {
          tl.fromTo(mascot, { y: 0 }, { y: 5, duration: 0.07, yoyo: true, repeat: 1, ease: "power1.inOut" }, at);
          tl.fromTo(
            spark,
            { scale: 0.3, autoAlpha: 1, rotation: -25 },
            { scale: 1.25, autoAlpha: 0, rotation: 20, duration: 0.32, ease: "power2.out" },
            at,
          );
        }

        // nome: letras "CCM" estourando, barra e subtítulo
        tl.fromTo(
          letters,
          { yPercent: 55, autoAlpha: 0, scale: 0.6 },
          { yPercent: 0, autoAlpha: 1, scale: 1, duration: 0.5, stagger: 0.09, ease: "back.out(1.8)" },
          TEXT_AT,
        );
        tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.inOut" }, TEXT_AT + 0.2);
        tl.fromTo(sub, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, TEXT_AT + 0.35);

        // barra de progresso acompanha a abertura inteira
        const hold = TEXT_AT + 0.35 + 0.45 + 0.75;
        tl.fromTo(progress, { scaleX: 0 }, { scaleX: 1, duration: hold, ease: "none" }, 0);

        // saída: a tela some enquanto o palco "avança" para o site
        tl.to(stage, { scale: 1.06, duration: 0.55, ease: "power2.inOut" }, hold);
        tl.to(root, { autoAlpha: 0, duration: 0.55, ease: "power2.inOut" }, hold);
      });
    };

    // espera os quadros decodificarem (no máximo 1,5 s) para não piscar
    const decode = Promise.all(frames.map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));
    const timeout = new Promise<void>((r) => window.setTimeout(r, 1500));
    void Promise.race([decode, timeout]).then(start);

    return () => {
      cancelled = true;
      root.removeEventListener("click", skip);
      window.removeEventListener("keydown", onKey);
      ctx.revert();
      document.documentElement.style.removeProperty("overflow");
    };
  }, []);

  if (done) return null;

  return (
    <div
      ref={rootRef}
      className="intro-overlay fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-brand-navy text-white select-none"
      role="status"
      aria-live="polite"
      aria-label="Abrindo a Multigiro Central de Compras"
    >
      {/* fundo: brilho azul + "sol" amarelo */}
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_70%,rgb(0_96_200/0.55),transparent_70%)]" />
      <div aria-hidden="true" className="absolute top-1/2 left-1/2 size-[min(78vw,420px)] -translate-x-1/2 -translate-y-[62%] rounded-full bg-brand-yellow/12 md:size-[520px]" />

      <div data-stage className="relative flex flex-col items-center will-change-transform">
        <div data-mascot className="relative h-[240px] w-[158px] opacity-0 sm:h-[300px] sm:w-[197px] md:h-[340px] md:w-[223px]">
          {FRAMES.map((src, i) => (
            <img
              key={src}
              data-frame
              src={src}
              alt=""
              width={341}
              height={520}
              decoding="async"
              fetchPriority={i === 0 ? "high" : "auto"}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ visibility: "hidden" }}
            />
          ))}
          {/* faísca da martelada (posição do martelo no quadro 2) */}
          <svg data-spark viewBox="0 0 48 48" aria-hidden="true" className="absolute top-[38%] -right-[14%] size-12 text-brand-yellow opacity-0 md:size-16">
            <path d="M24 2l4 13 13 4-13 4-4 13-4-13-13-4 13-4z" fill="currentColor" />
            <path d="M8 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM40 30l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="currentColor" opacity=".8" />
          </svg>
          {/* sombra no chão */}
          <div aria-hidden="true" className="absolute -bottom-2 left-1/2 h-4 w-[70%] -translate-x-1/2 rounded-[100%] bg-black/35 blur-md" />
        </div>

        <div className="mt-6 flex flex-col items-center md:mt-8">
          <p className="flex font-heading text-[4.2rem] leading-none font-extrabold tracking-[-0.04em] text-brand-yellow md:text-[6rem]" aria-label="CCM">
            {LETTERS.map((l, i) => (
              <span key={i} data-letter className="inline-block opacity-0" aria-hidden="true">
                {l}
              </span>
            ))}
          </p>
          <span data-bar aria-hidden="true" className="mt-2 h-1 w-16 origin-left rounded-full bg-brand-yellow opacity-0 md:w-24" />
          <p data-sub className="mt-3 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-white/85 opacity-0 md:text-sm">
            Central de Compras Multigiro
          </p>
        </div>
      </div>

      {/* progresso + pular */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
        <div data-progress className="h-full w-full origin-left scale-x-0 bg-brand-yellow" />
      </div>
      <span className="absolute right-4 bottom-4 text-[0.7rem] font-medium tracking-wide text-white/60 md:right-6 md:bottom-5">
        Toque para pular
      </span>
    </div>
  );
}
