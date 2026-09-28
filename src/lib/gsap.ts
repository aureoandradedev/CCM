"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

// Registrar UMA vez, em módulo cliente. Todo componente animado importa daqui.
gsap.registerPlugin(useGSAP, ScrollTrigger);

gsap.defaults({ ease: "power3.out", duration: 0.5 });

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { gsap, ScrollTrigger, useGSAP };
