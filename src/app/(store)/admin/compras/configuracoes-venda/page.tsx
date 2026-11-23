import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card, NotConfigured, PageTitle, Table, Th } from "@/components/admin/ui";
import { CcmConfigsPanel } from "@/components/admin/ccm-configs-panel";
import { adminConfigs, configured } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";

function formatValue(v: unknown): string {
  if (v === true) return "Ativo";
  if (v === false) return "Desativado";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export default async function ConfiguracoesVendaPage() {
  if (!configured()) return <NotConfigured />;
  const sb = await createClient();

  const [configs, { data: history }] = await Promise.all([
    adminConfigs(),
    sb.from("ccm_config_history")
      .select("id, config_id, key, scope, scope_ref, old_value, new_value, changed_by, changed_at")
      .order("changed_at", { ascending: false })
      .limit(20),
  ]);

  const sectionConfigs = configs.filter((c) => c.scope === "section");
  const productConfigs = configs.filter((c) => c.scope === "product");
  const globalConfigs = configs.filter((c) => c.scope === "global");

  return (
    <>
      <Link
        href="/admin/compras"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <PageTitle title="Configurações de venda" subtitle="Flags, limites e descontos por seção/produto" />

      <div className="mb-6">
        <Card title="Todas as configurações CCM">
          <CcmConfigsPanel configs={configs} />
        </Card>
      </div>

      {sectionConfigs.length > 0 && (
        <Card title="Configurações por seção" className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Seção</Th>
                <Th>Chave</Th>
                <Th>Valor</Th>
              </tr>
            </thead>
            <tbody>
              {sectionConfigs.map((c) => (
                <tr key={c.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{c.scope_ref}</td>
                  <td className="px-3 py-2">{c.key}</td>
                  <td className="px-3 py-2 tabular-nums">{formatValue(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {productConfigs.length > 0 && (
        <Card title="Exceções por produto" className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Chave</Th>
                <Th>Valor</Th>
              </tr>
            </thead>
            <tbody>
              {productConfigs.map((c) => (
                <tr key={c.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{c.scope_ref}</td>
                  <td className="px-3 py-2">{c.key}</td>
                  <td className="px-3 py-2 tabular-nums">{formatValue(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="Histórico de alterações">
        {history && history.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Chave</Th>
                <Th>Escopo</Th>
                <Th>Anterior</Th>
                <Th>Novo</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-brand-line last:border-0">
                  <td className="px-3 py-2 font-medium">{h.key}</td>
                  <td className="px-3 py-2">{h.scope}{h.scope_ref ? `: ${h.scope_ref}` : ""}</td>
                  <td className="px-3 py-2 text-brand-ink-soft">{formatValue(h.old_value)}</td>
                  <td className="px-3 py-2 font-medium">{formatValue(h.new_value)}</td>
                  <td className="px-3 py-2 text-brand-ink-soft">{new Date(h.changed_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-brand-ink-soft">Nenhuma alteração registrada.</p>
        )}
      </Card>
    </>
  );
}
