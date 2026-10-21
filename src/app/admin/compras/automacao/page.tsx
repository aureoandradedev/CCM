import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { listExceptions, exceptionStats, lastRunSummary } from "@/lib/admin/orchestrator";
import { ProcessarPendenciasButton, ExceptionBadge, ResolveExceptionForm } from "../_components";

export default async function AutomacaoPage(props: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  const status = searchParams.status ?? "open";
  const type = searchParams.type ?? undefined;
  const page = Number(searchParams.page) || 1;

  const [{ exceptions, total }, stats, lastRun] = await Promise.all([
    listExceptions(sbAny, { status, type, page }),
    exceptionStats(sbAny),
    lastRunSummary(sbAny),
  ]);

  const totalPages = Math.ceil(total / 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-brand-fg">Automação do Comprador</h1>
          <p className="text-sm text-brand-fg/60">
            Orquestrador de compras — normalização, matching, ofertas e exceções.
          </p>
        </div>
        <ProcessarPendenciasButton />
      </div>

      {/* Last run info */}
      {lastRun && (
        <div className="rounded-lg border border-brand-line bg-brand-bg/50 p-4 text-sm">
          <span className="font-medium">Última execução:</span>{" "}
          {new Date(lastRun.created_at).toLocaleString("pt-BR")} —{" "}
          {String((lastRun.detail as Record<string, unknown>).duration_ms)}ms
          {" · "}
          <span className={`font-medium ${(lastRun.detail as Record<string, unknown>).status === "completed" ? "text-green-600" : (lastRun.detail as Record<string, unknown>).status === "partial" ? "text-yellow-600" : "text-brand-fg/60"}`}>
            {String((lastRun.detail as Record<string, unknown>).status ?? "completed")}
          </span>
          {" · "}
          <span className="text-brand-fg/60">ID: {lastRun.run_id}</span>
        </div>
      )}

      {/* Exception stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[
          { key: "review_match", label: "Match", color: "text-yellow-600" },
          { key: "review_ranking", label: "Ranking", color: "text-orange-600" },
          { key: "no_offer", label: "Sem oferta", color: "text-red-600" },
          { key: "source_changed", label: "Mudou", color: "text-amber-600" },
          { key: "stale_sourcing", label: "Sourcing", color: "text-red-700" },
          { key: "stale_publication", label: "Publicação", color: "text-purple-600" },
          { key: "economy_opportunity", label: "Economia", color: "text-blue-600" },
          { key: "inactive_item", label: "Inativos", color: "text-gray-600" },
          { key: "total", label: "Total", color: "text-brand-fg" },
        ].map(({ key, label, color }) => (
          <Link
            key={key}
            href={key === "total" ? "/admin/compras/automacao?status=open" : `/admin/compras/automacao?status=open&type=${key}`}
            className="rounded-lg border border-brand-line bg-white p-3 text-center transition hover:border-brand-navy/40"
          >
            <div className={`text-xl font-bold ${color}`}>{stats[key] ?? 0}</div>
            <div className="text-[10px] text-brand-fg/60">{label}</div>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 text-xs">
        {["open", "resolved", "dismissed"].map((s) => (
          <Link
            key={s}
            href={`/admin/compras/automacao?status=${s}${type ? `&type=${type}` : ""}`}
            className={`rounded px-3 py-1 ${status === s ? "bg-brand-navy text-white" : "bg-brand-bg text-brand-fg/70 hover:bg-brand-line"}`}
          >
            {s === "open" ? "Abertas" : s === "resolved" ? "Resolvidas" : "Dispensadas"}
          </Link>
        ))}
      </div>

      {/* Exception list */}
      <div className="overflow-x-auto rounded-lg border border-brand-line">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-brand-line bg-brand-bg/50 text-xs text-brand-fg/60">
            <tr>
              <th className="px-3 py-2">Tipo / Severidade</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2">Criada em</th>
              {status === "open" && <th className="px-3 py-2">Ações</th>}
              {status !== "open" && <th className="px-3 py-2">Resolvida em</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-line">
            {exceptions.map((ex) => (
              <tr key={ex.id} className="hover:bg-brand-bg/30">
                <td className="px-3 py-2">
                  <ExceptionBadge type={ex.type} severity={ex.severity} />
                </td>
                <td className="px-3 py-2 text-sm">{ex.title}</td>
                <td className="px-3 py-2 text-xs text-brand-fg/60">
                  {new Date(ex.created_at).toLocaleString("pt-BR")}
                </td>
                {status === "open" && (
                  <td className="px-3 py-2">
                    <ResolveExceptionForm exceptionId={ex.id} />
                  </td>
                )}
                {status !== "open" && (
                  <td className="px-3 py-2 text-xs text-brand-fg/60">
                    {ex.resolved_at ? new Date(ex.resolved_at).toLocaleString("pt-BR") : "—"}
                    {ex.resolution_note && <span className="ml-1 text-brand-fg/40">({ex.resolution_note})</span>}
                  </td>
                )}
              </tr>
            ))}
            {exceptions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-brand-fg/40">
                  Nenhuma exceção {status === "open" ? "aberta" : status === "resolved" ? "resolvida" : "dispensada"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 text-xs">
          {page > 1 && (
            <Link
              href={`/admin/compras/automacao?status=${status}${type ? `&type=${type}` : ""}&page=${page - 1}`}
              className="rounded bg-brand-bg px-3 py-1 text-brand-fg/70 hover:bg-brand-line"
            >
              Anterior
            </Link>
          )}
          <span className="px-3 py-1 text-brand-fg/60">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/compras/automacao?status=${status}${type ? `&type=${type}` : ""}&page=${page + 1}`}
              className="rounded bg-brand-bg px-3 py-1 text-brand-fg/70 hover:bg-brand-line"
            >
              Próxima
            </Link>
          )}
        </div>
      )}

      {/* Back link */}
      <div className="text-xs">
        <Link href="/admin/compras" className="text-brand-navy hover:underline">
          ← Voltar para Compras
        </Link>
      </div>
    </div>
  );
}
