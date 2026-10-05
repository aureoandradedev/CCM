import Link from "next/link";
import { Headset, MapPin, PackageSearch, Truck } from "lucide-react";

import { getSiteSettings } from "@/lib/data/catalog";
import { site, whatsappLink } from "@/lib/site";

/** Barra de utilidades (Telhanorte/Obramax): diferenciais à esquerda, atendimento à direita. */
export async function TopBar() {
  const { avisoTopo } = await getSiteSettings();
  return (
    <div data-site-chrome className="bg-brand-navy text-[0.72rem] whitespace-nowrap text-white/85 sm:text-[0.78rem]">
      <div className="container-ccm flex h-9 items-center justify-between gap-4">
        {avisoTopo ? (
          <p className="truncate font-semibold text-brand-yellow">{avisoTopo}</p>
        ) : (
          <ul className="flex items-center gap-5">
            <li className="flex items-center gap-1.5">
              <MapPin className="size-3.5 text-brand-yellow" />
              <span>Entrega em todo o Sul do ES</span>
            </li>
            <li className="hidden items-center gap-1.5 md:flex">
              <Truck className="size-3.5 text-brand-yellow" />
              <span>Direto do fornecedor, sem intermediário</span>
            </li>
          </ul>
        )}
        <ul className="flex items-center gap-5">
          <li className="hidden sm:block">
            <a href={whatsappLink("Olá! Quero falar com a televendas da Multigiro Central de Compras.")} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white">
              <Headset className="size-3.5 text-brand-yellow" />
              Televendas {site.phone}
            </a>
          </li>
          <li>
            <Link href="/conta/pedidos" className="flex items-center gap-1.5 hover:text-white">
              <PackageSearch className="size-3.5 text-brand-yellow" />
              <span className="hidden sm:inline">Acompanhar pedido</span>
              <span className="sm:hidden">Meu pedido</span>
            </Link>
          </li>
          <li className="hidden lg:block">
            <Link href="/fornecedores" className="font-semibold text-brand-yellow hover:text-brand-yellow-2">
              Seja um fornecedor
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
