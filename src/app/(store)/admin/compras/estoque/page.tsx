import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, Kpi, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminInventorySummary, adminInventoryTotal, configured } from "@/lib/admin/data";
import { InventoryMovementForm } from "./_form";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

export default async function EstoquePage() {
  if (!configured()) return <NotConfigured />;
  const [items, totals] = await Promise.all([
    adminInventorySummary(),
    adminInventoryTotal(),
  ]);

  const atCeiling = totals.ceiling_centavos != null && totals.total_value_centavos >= totals.ceiling_centavos;

  return (
    <>
      <Link
        href="/admin/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle title="Estoque de sobra" subtitle="Unidades que sobraram de compras em caixa fechada" />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Itens em estoque" value={String(items.length)} />
        <Kpi label="Valor parado" value={formatBRL(totals.total_value_centavos)} tone={atCeiling ? "red" : "navy"} />
        <Kpi
          label="Teto de sobra"
          value={totals.ceiling_centavos != null ? formatBRL(totals.ceiling_centavos) : "Sem teto"}
          hint={atCeiling ? "ATINGIDO — bloqueio de unidade_e_caixa" : undefined}
          tone={atCeiling ? "red" : "slate"}
        />
      </div>

      <Card title="Estoque atual" className="mb-6">
        {items.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Quantidade</Th>
                <Th>Custo un.</Th>
                <Th>Valor total</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.master_product_id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{i.product_name}</td>
                  <td className="px-3 py-2 tabular-nums">{i.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(i.unit_cost_centavos)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(i.total_value_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">Estoque vazio.</p>
        )}
      </Card>

      <InventoryMovementForm />
    </>
  );
}
