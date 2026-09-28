import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Reveal } from "@/components/motion/reveal";
import { Icon } from "@/components/ui/icon";
import { getCategories } from "@/lib/data/catalog";

export const metadata: Metadata = {
  title: "Todos os departamentos",
  description: "Materiais básicos, pisos, tintas, hidráulica, elétrica, louças, ferramentas, telhas, portas e iluminação.",
};

export default async function DepartmentsPage() {
  const categories = await getCategories();
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Departamentos" }]} />
      <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem] dark:text-foreground">Todos os departamentos</h1>
      <p className="mt-2 max-w-2xl text-sm text-brand-ink-soft">Do alicerce ao acabamento. Cada departamento tem fornecedores parceiros com preço de varejo e de atacado.</p>

      <Reveal stagger={0.05}>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li key={c.slug} data-reveal>
              <article className="lift group flex h-full flex-col overflow-hidden rounded-3xl border border-brand-line bg-card shadow-[var(--shadow-card)]">
                <Link href={`/categoria/${c.slug}`} className="relative block h-40 overflow-hidden bg-muted" tabIndex={-1} aria-hidden="true">
                  {c.image ? <Image src={c.image} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-105" /> : null}
                  <span className="absolute top-3 left-3 inline-flex size-10 items-center justify-center rounded-xl bg-brand-yellow text-brand-navy shadow">
                    <Icon name={c.icon} className="size-5" />
                  </span>
                </Link>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">
                    <Link href={`/categoria/${c.slug}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-brand-ink-soft">{c.description}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {c.children.map((s) => (
                      <li key={s.slug}>
                        <Link href={`/categoria/${c.slug}?sub=${s.slug}`} className="inline-flex h-7 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-yellow-soft hover:text-brand-navy">
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/categoria/${c.slug}`} className="mt-4 inline-flex items-center gap-1 font-heading text-sm font-bold text-brand-navy hover:underline dark:text-foreground">
                    Ver tudo <ArrowRight className="size-4" />
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
