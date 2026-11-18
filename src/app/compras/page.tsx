import Link from "next/link";
import { Boxes } from "lucide-react";

export default function ComprasPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <Boxes className="mx-auto mb-4 size-12 text-brand-navy" />
      <h1 className="font-heading text-2xl font-bold text-brand-navy">Painel de Compras</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Esta área está em construção. Em breve você poderá gerenciar pedidos de compra, pendências e fornecedores.
      </p>
      <Link href="/conta" className="mt-6 inline-block text-sm font-semibold text-brand-blue underline">
        Voltar para minha conta
      </Link>
    </div>
  );
}
