import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminSuppliers, configured } from "@/lib/admin/data";
import { WEEKDAY_SHORT_PT } from "@/lib/purchase-cycle";
import { createClient } from "@/lib/supabase/server";
import { getOperationalSupplierIds } from "@/lib/admin/supplier-guards";

function formatReais(v: number | null): string {
  if (v == null) return "—";
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

interface ActiveTerms {
  supplier_id: string;
  pedido_minimo_tipo: string;
  pedido_minimo: number;
  dias_pedido: number[];
  prazo_entrega_cd_dias: number;
  frete_tipo: string;
  frete_gratis_acima: number | null;
  frete_valor: number | null;
}

export default async function CondicoesPage() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();
  const [suppliers, operationalIds, termsRows] = await Promise.all([
    adminSuppliers(),
    getOperationalSupplierIds(sb),
    sb
      .from("supplier_commercial_terms")
      .select("supplier_id, pedido_minimo_tipo, pedido_minimo, dias_pedido, prazo_entrega_cd_dias, frete_tipo, frete_gratis_acima, frete_valor")
      .eq("active", true)
      .is("valid_to", null)
      .then((r) => (r.data ?? []) as ActiveTerms[]),
  ]);

  const termsMap = new Map(termsRows.map((t) => [t.supplier_id, t]));
  const withTerms = suppliers.filter((s) => termsMap.has(s.id));

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
                <Th>Status</Th>
                <Th>Pedido mínimo</Th>
                <Th>Dias de pedido</Th>
                <Th>Prazo entrega</Th>
                <Th>Frete</Th>
              </tr>
            </thead>
            <tbody>
              {withTerms.map((s) => {
                const t = termsMap.get(s.id)!;
                return (
                  <tr key={s.id} className="border-b border-brand-line last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/admin/fornecedores/${s.id}`} className="font-medium text-brand-navy hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {operationalIds.has(s.id) ? (
                        <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">Operacional</span>
                      ) : (
                        <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Pendente</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatReais(t.pedido_minimo)} ({t.pedido_minimo_tipo ?? "valor"})
                    </td>
                    <td className="px-3 py-2">
                      {t.dias_pedido?.length
                        ? t.dias_pedido.map((d) => WEEKDAY_SHORT_PT[d] ?? d).join(", ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{t.prazo_entrega_cd_dias} dia(s) úteis</td>
                    <td className="px-3 py-2">
                      {t.frete_tipo === "gratis_acima"
                        ? `Grátis acima de ${formatReais(t.frete_gratis_acima)}, senão ${formatReais(t.frete_valor)}`
                        : t.frete_tipo === "fixo"
                          ? `Fixo: ${formatReais(t.frete_valor)}`
                          : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">
            Nenhum fornecedor com condições comerciais cadastradas.
          </p>
        )}
      </Card>
    </>
  );
}
