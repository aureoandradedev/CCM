import Link from "next/link";
import { SearchX } from "lucide-react";

import type { Product } from "@/types/catalog";
import { Reveal } from "@/components/motion/reveal";
import { ProductCard } from "@/components/product/product-card";
import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/site";

export function ProductGrid({ products, emptyTitle = "Nenhum produto encontrado", emptyHint }: { products: Product[]; emptyTitle?: string; emptyHint?: React.ReactNode }) {
  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-brand-line bg-card px-6 py-16 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-muted text-brand-ink-soft">
          <SearchX className="size-7" />
        </span>
        <div>
          <p className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">{emptyTitle}</p>
          <p className="mt-1 max-w-sm text-sm text-brand-ink-soft">
            {emptyHint ?? "Tente outras palavras, tire um filtro ou fale com a televendas: a gente cota com os fornecedores."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline-navy" render={<Link href="/departamentos" />}>
            Ver departamentos
          </Button>
          <Button variant="whatsapp" render={<a href={whatsappLink("Olá! Não achei um produto na Multigiro Central de Compras e queria cotar.")} target="_blank" rel="noreferrer" />}>
            Cotar pelo WhatsApp
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Reveal stagger={0.04} y={14}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 2xl:grid-cols-4" aria-label="Produtos">
        {products.map((p, i) => (
          <li key={p.id} className="min-w-0">
            <ProductCard product={p} priority={i < 4} sizes="(min-width: 1536px) 22vw, (min-width: 768px) 28vw, 50vw" />
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
