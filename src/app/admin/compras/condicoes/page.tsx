import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminSuppliers, configured } from "@/lib/admin/data";
import { WEEKDAY_SHORT_PT } from "@/lib/purchase-cycle";

function formatCentavos(v: number | null): string {
  if (v == null) return "—";
  return `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
}

export default async function CondicoesPage() {
  if (!configured()) return <NotConfigured />;
  const suppliers = await adminSuppliers();
  const withTerms = suppliers.filter((s) => s.dias_pedido?.length || s.pedido_minimo_centavos != null);

  return (
    <>
      <Link
        href="/admin/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle
        title="Condições comerciais"
        subtitle="Resumo das condições cadastradas por fornecedor. Edite na ficha do fornecedor."
      />

      <Card title="Fornecedores com condições">
        {withTerms.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Pedido mínimo</Th>
                <Th>Dias de pedido</Th>
                <Th>Prazo entrega</Th>
                <Th>Frete</Th>
              </tr>
            </thead>
            <tbody>
              {withTerms.map((s) => (
                <tr key={s.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/admin/fornecedores/${s.id}`} className="font-medium text-brand-navy hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.pedido_minimo_centavos != null
                      ? `${formatCentavos(s.pedido_minimo_centavos)} (${s.pedido_minimo_tipo ?? "valor"})`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {s.dias_pedido?.length
                      ? s.dias_pedido.map((d) => WEEKDAY_SHORT_PT[d] ?? d).join(", ")
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{s.lead_time_days} dia(s) úteis</td>
                  <td className="px-3 py-2">
                    {s.frete_tipo === "gratis_acima"
                      ? `Grátis acima de ${formatCentavos(s.frete_gratis_acima_centavos)}, senão ${formatCentavos(s.frete_valor_centavos)}`
                      : s.frete_tipo === "fixo"
                        ? `Fixo: ${formatCentavos(s.frete_valor_centavos)}`
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">
            Nenhum fornecedor com condições comerciais cadastradas.{" "}
            <Link href="/admin/fornecedores" className="text-brand-navy hover:underline">
              Cadastrar
            </Link>
          </p>
        )}
      </Card>
    </>
  );
}
