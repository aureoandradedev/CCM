import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { getBrands } from "@/lib/data/catalog";

export const metadata: Metadata = { title: "Marcas", description: "Todas as marcas disponíveis nos fornecedores parceiros da Multigiro Central de Compras." };

export default async function BrandsPage() {
  const brands = await getBrands();
  const groups = new Map<string, typeof brands>();
  for (const b of brands.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
    const letter = b.name[0].toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(b);
  }

  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: "Marcas" }]} />
      <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem] dark:text-foreground">Marcas</h1>
      <p className="mt-2 text-sm text-brand-ink-soft">Escolha a marca para ver todos os produtos disponíveis nos fornecedores parceiros.</p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from(groups.entries()).map(([letter, list]) => (
          <section key={letter} className="rounded-2xl border border-brand-line bg-card p-5">
            <h2 className="font-heading text-2xl font-extrabold text-brand-orange">{letter}</h2>
            <ul className="mt-2 space-y-1">
              {list.map((b) => (
                <li key={b.slug}>
                  <Link href={`/busca?marca=${b.slug}`} className="text-sm font-medium text-brand-ink hover:text-brand-navy hover:underline dark:hover:text-foreground">
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
