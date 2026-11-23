import Image from "next/image";
import Link from "next/link";

import { SearchBar } from "@/components/layout/search-bar";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-ccm flex flex-col items-center pt-12 pb-10 text-center">
      <Image src="/brand/mascote-capacete-alpha.png" alt="" width={686} height={961} className="h-52 w-auto" priority />
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">Erro 404</p>
      <h1 className="mt-1 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:text-[2.6rem] dark:text-foreground">Essa página não está na planta.</h1>
      <p className="mt-2 max-w-md text-sm text-brand-ink-soft">O link pode ter mudado ou o produto saiu do catálogo. Busque de novo ou volte para o início.</p>
      <div className="mt-6 w-full max-w-xl">
        <SearchBar />
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="brand" size="lg" render={<Link href="/" />}>
          Ir para o início
        </Button>
        <Button variant="outline-navy" size="lg" render={<Link href="/departamentos" />}>
          Ver departamentos
        </Button>
      </div>
    </div>
  );
}
