import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, Kpi, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { adminConfigs, configured } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { PriceActionButtons } from "./actions-panel";

function formatBRL(centavos: number) {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

export default async function PrecosPage() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();

  const [configs, { data: blocked }, { data: recent }, { data: replacements }] = await Promise.all([
    adminConfigs(),
    sb.from("price_change_log").select("*").eq("blocked", true).is("approved_by", null).order("created_at", { ascending: false }).limit(50),
    sb.from("price_change_log").select("*").order("created_at", { ascending: false }).limit(30),
    sb.from("supplier_replacement_log").select("*").order("created_at", { ascending: false }).limit(20),
  ]);

  const autoEnabled = configs.find((c) => c.key === "auto_price_enabled")?.value === true;
  const switchEnabled = configs.find((c) => c.key === "auto_switch_enabled")?.value === true;

  return (
    <>
      <Link
        href="/admin/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle title="Preços e fornecedores" subtitle="Automação de preço (R5) e troca de fornecedor (R6)" />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi
          label="Auto-preço"
          value={autoEnabled ? "LIGADO" : "DESLIGADO"}
          tone={autoEnabled ? "green" : "slate"}
        />
        <Kpi
          label="Auto-troca"
          value={switchEnabled ? "LIGADO" : "DESLIGADO"}
          tone={switchEnabled ? "green" : "slate"}
        />
        <Kpi label="Bloqueados" value={String(blocked?.length ?? 0)} tone={blocked && blocked.length > 0 ? "red" : "slate"} />
        <Kpi label="Trocas recentes" value={String(replacements?.length ?? 0)} />
      </div>

      {blocked && blocked.length > 0 && (
        <Card title="Preços bloqueados — aguardando aprovação (R5.4)" className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Preço anterior</Th>
                <Th>Preço novo</Th>
                <Th>Variação</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {blocked.map((pc) => (
                <tr key={pc.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{pc.product_id}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(pc.old_price_centavos ?? 0)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(pc.new_price_centavos)}</td>
                  <td className="px-3 py-2 tabular-nums text-brand-red">
                    +{Number(pc.change_pct).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2">
                    <PriceActionButtons logId={pc.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="Histórico de preços" className="mb-6">
        {recent && recent.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>De</Th>
                <Th>Para</Th>
                <Th>Var.</Th>
                <Th>Auto</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((pc) => (
                <tr key={pc.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2">{pc.product_id}</td>
                  <td className="px-3 py-2 tabular-nums">{pc.old_price_centavos ? formatBRL(pc.old_price_centavos) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatBRL(pc.new_price_centavos)}</td>
                  <td className="px-3 py-2 tabular-nums">{pc.change_pct ? `${Number(pc.change_pct) > 0 ? "+" : ""}${Number(pc.change_pct).toFixed(1)}%` : "—"}</td>
                  <td className="px-3 py-2">{pc.auto_applied ? "Sim" : pc.blocked ? "Bloqueado" : "Manual"}</td>
                  <td className="px-3 py-2 text-brand-ink-soft">{new Date(pc.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">Nenhuma alteração de preço registrada.</p>
        )}
      </Card>

      <Card title="Trocas de fornecedor (R6.4)">
        {replacements && replacements.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>De</Th>
                <Th>Para</Th>
                <Th>Motivo</Th>
                <Th>Auto</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {replacements.map((r) => (
                <tr key={r.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{r.master_product_id}</td>
                  <td className="px-3 py-2">{r.old_supplier_id}</td>
                  <td className="px-3 py-2">{r.new_supplier_id}</td>
                  <td className="px-3 py-2">{r.reason}</td>
                  <td className="px-3 py-2">{r.auto_applied ? "Sim" : "Manual"}</td>
                  <td className="px-3 py-2 text-brand-ink-soft">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">Nenhuma troca registrada.</p>
        )}
      </Card>
    </>
  );
}
