import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { Plus } from "lucide-react";
import { CommercialTermsAdmin } from "@/components/admin/commercial-terms-admin";
import { SupplierForm } from "@/components/admin/settings-forms";
import { adminSupplierById, adminSupplierCommercialTerms, adminSupplierCatalogs, configured } from "@/lib/admin/data";
import { maskCNPJ } from "@/lib/utils/masks";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!configured()) return <NotConfigured />;
  const { id } = await params;
  const [supplier, terms, catalogs] = await Promise.all([
    adminSupplierById(id),
    adminSupplierCommercialTerms(id),
    adminSupplierCatalogs(id),
  ]);
  if (!supplier) notFound();

  return (
    <>
      <Link
        href="/admin/fornecedores"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink-soft hover:text-brand-navy"
      >
        <ArrowLeft className="size-4" /> Fornecedores
      </Link>

      <PageTitle
        title={supplier.name}
        subtitle={supplier.active ? undefined : "Fornecedor inativo"}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="CNPJ" value={supplier.cnpj ? maskCNPJ(supplier.cnpj) : "—"} />
        <InfoCard label="Razão social" value={supplier.trade_name ?? "—"} />
        <InfoCard label="Nome fantasia" value={supplier.name} />
        <InfoCard label="Cidade" value={supplier.city ?? "—"} />
        <InfoCard label="UF" value={supplier.state ?? "—"} />
        <InfoCard label="Prazo de entrega no CD" value={`${supplier.lead_time_days} dia(s) úteis`} />
        <InfoCard label="Contato" value={supplier.contact_name ?? "—"} />
        <InfoCard label="E-mail" value={supplier.contact_email ?? "—"} />
        <InfoCard label="Telefone" value={supplier.contact_phone ?? "—"} />
      </div>

      <details className="mt-4 rounded-2xl border border-brand-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-navy dark:text-foreground">
          Editar dados cadastrais
        </summary>
        <div className="px-4 pb-4">
          <SupplierForm supplier={supplier} />
        </div>
      </details>

      <CommercialTermsAdmin supplierId={supplier.id} terms={terms} />

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
            Catálogos
          </h2>
          <Link
            href={`/admin/fornecedores/${supplier.id}/importar`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-navy/90"
          >
            <Plus className="size-3.5" /> Importar catálogo
          </Link>
        </div>
        {catalogs.length > 0 ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-brand-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-line bg-muted/50 text-left text-xs font-bold uppercase tracking-wider text-brand-ink-soft">
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Origem</th>
                  <th className="px-4 py-2">Itens</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {catalogs.map((c) => (
                  <tr key={c.id} className="border-b border-brand-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-2">{c.source_name ?? c.source}</td>
                    <td className="px-4 py-2">{c.total_items}</td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold">{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-brand-ink-soft">Nenhum catálogo importado.</p>
        )}
      </section>

    </>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-card p-4">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-brand-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-ink">{value}</p>
    </div>
  );
}
