import Link from "next/link";

import type { Brand } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";

export function BrandsStrip({ brands }: { brands: Brand[] }) {
  return (
    <Reveal as="section" className="container-ccm" aria-labelledby="brands-title" stagger={0.02} y={8}>
      <div className="rounded-3xl border border-brand-line bg-card px-6 py-7 md:px-8">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <h2 id="brands-title" className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">
            Marcas que a obra confia
          </h2>
          <Link href="/marcas" className="text-sm font-semibold text-brand-navy hover:underline dark:text-foreground">
            Ver todas as marcas
          </Link>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {brands.map((b) => (
            <li key={b.slug} data-reveal>
              <Link
                href={`/busca?marca=${b.slug}`}
                className="press inline-flex h-9 items-center rounded-full border border-brand-line bg-background px-4 font-heading text-sm font-bold text-brand-ink transition-colors hover:border-brand-yellow hover:bg-brand-yellow-soft hover:text-brand-navy"
              >
                {b.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}
