"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Galeria da página do produto: foto inteira (sem corte) em moldura branca,
 * miniaturas ao lado no desktop e embaixo no celular. Sem zoom no hover:
 * a foto de produto precisa aparecer por inteiro e estável.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const list = images.length ? images : [""];

  return (
    <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
      <div className="relative aspect-square w-full max-h-[70vh] overflow-hidden rounded-3xl border border-brand-line bg-white">
        {list.map((src, i) =>
          src ? (
            <Image
              key={src + i}
              src={src}
              alt={i === 0 ? name : `${name}, imagem ${i + 1}`}
              fill
              priority={i === 0}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className={cn(
                "object-contain p-4 transition-opacity duration-300 ease-[var(--ease-out)] md:p-6",
                i === active ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            />
          ) : null,
        )}
      </div>

      {list.length > 1 ? (
        <ul className="flex shrink-0 gap-2 lg:w-20 lg:flex-col" aria-label="Miniaturas">
          {list.map((src, i) => (
            <li key={src + i}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                aria-label={`Imagem ${i + 1}`}
                className={cn(
                  "press relative size-16 overflow-hidden rounded-xl border-2 bg-white transition-colors lg:size-20",
                  i === active ? "border-brand-yellow" : "border-brand-line hover:border-brand-navy/40",
                )}
              >
                {src ? <Image src={src} alt="" fill sizes="80px" className="object-contain p-1" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
