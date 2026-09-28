import type { Metadata } from "next";

import { OrderLookup } from "@/components/account/order-lookup";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export const metadata: Metadata = { title: "Meus pedidos", robots: { index: false } };

export default function OrdersPage() {
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ href: "/conta", label: "Minha conta" }, { label: "Meus pedidos" }]} />
      <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem] dark:text-foreground">Acompanhar pedido</h1>
      <p className="mt-2 max-w-xl text-sm text-brand-ink-soft">Digite o CPF ou CNPJ usado na compra e o número do pedido para ver o status de cada remessa.</p>
      <div className="mt-6">
        <OrderLookup />
      </div>
    </div>
  );
}
