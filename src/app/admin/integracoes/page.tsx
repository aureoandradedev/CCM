import { Card, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { configured, adminIntegrations, adminBatches } from "@/lib/admin/data";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  disconnected: { label: "Desconectado", cls: "bg-gray-100 text-gray-600" },
  configured: { label: "Configurado", cls: "bg-blue-100 text-blue-800" },
  testing: { label: "Testando", cls: "bg-yellow-100 text-yellow-800" },
  connected: { label: "Conectado", cls: "bg-green-100 text-green-800" },
  syncing: { label: "Sincronizando", cls: "bg-blue-100 text-blue-800" },
  error: { label: "Com erro", cls: "bg-red-100 text-red-800" },
  paused: { label: "Pausado", cls: "bg-gray-100 text-gray-600" },
};

const METHOD_LABELS: Record<string, string> = {
  erp: "ERP",
  csv: "CSV/Excel",
  api: "API REST",
  feed: "Feed",
  manual: "Manual",
};

const BATCH_STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "Em andamento", cls: "text-blue-600" },
  completed: { label: "Concluido", cls: "text-green-600" },
  partial: { label: "Parcial", cls: "text-amber-600" },
  failed: { label: "Falhou", cls: "text-red-600" },
};

export default async function AdminIntegrationsPage() {
  if (!configured()) return <NotConfigured />;
  const [integrations, batches] = await Promise.all([
    adminIntegrations(),
    adminBatches(undefined, 15),
  ]);

  return (
    <>
      <PageTitle
        title="Integracoes"
        subtitle="Conexoes de fornecedores com o CCM. Integracao nunca publica diretamente na vitrine."
      />

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">
        Integracoes por fornecedor
      </h3>

      {integrations.length === 0 ? (
        <Card className="mb-8">
          <p className="py-6 text-center text-sm text-brand-ink-soft">
            Nenhuma integracao configurada.
          </p>
        </Card>
      ) : (
        <div className="mb-8 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Metodo</Th>
                <Th>Status</Th>
                <Th>Modo</Th>
                <Th className="text-right">Itens</Th>
                <Th className="text-right">Validos</Th>
                <Th className="text-right">Erros</Th>
                <Th>Ultima sync</Th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((it) => {
                const st = STATUS_LABELS[it.status] ?? {
                  label: it.status,
                  cls: "bg-gray-100 text-gray-600",
                };
                return (
                  <tr key={it.id}>
                    <Td className="font-medium">{it.supplier_name}</Td>
                    <Td>{METHOD_LABELS[it.method] ?? it.method}</Td>
                    <Td>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </Td>
                    <Td className="text-xs">
                      {it.sync_mode === "delta" ? "Incremental" : "Completo"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {it.product_count}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {it.valid_count}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {it.error_count > 0 ? (
                        <span className="font-medium text-red-600">
                          {it.error_count}
                        </span>
                      ) : (
                        "0"
                      )}
                    </Td>
                    <Td className="text-xs text-brand-ink-soft">
                      {it.last_sync_at
                        ? new Date(it.last_sync_at).toLocaleDateString(
                            "pt-BR",
                            {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )
                        : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-brand-ink-soft">
        Ultimos batches de importacao
      </h3>

      {batches.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-brand-ink-soft">
            Nenhum batch registrado.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Inicio</Th>
                <Th>Tipo</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Criados</Th>
                <Th className="text-right">Atualizados</Th>
                <Th className="text-right">Ignorados</Th>
                <Th className="text-right">Erros</Th>
                <Th>Duracao</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const bs = BATCH_STATUS[b.status] ?? {
                  label: b.status,
                  cls: "text-gray-600",
                };
                const duration =
                  b.finished_at && b.created_at
                    ? `${Math.round((new Date(b.finished_at).getTime() - new Date(b.created_at).getTime()) / 1000)}s`
                    : "—";
                return (
                  <tr key={b.id}>
                    <Td className="text-xs">
                      {new Date(b.created_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td className="text-xs">
                      {b.sync_type === "delta" ? "Delta" : "Full"}
                    </Td>
                    <Td>
                      <span className={`text-xs font-medium ${bs.cls}`}>
                        {bs.label}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{b.total}</Td>
                    <Td className="text-right tabular-nums">
                      {b.items_created}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {b.items_updated}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {b.items_ignored}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {b.error_count > 0 ? (
                        <span className="text-red-600">{b.error_count}</span>
                      ) : (
                        "0"
                      )}
                    </Td>
                    <Td className="text-xs text-brand-ink-soft">{duration}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
