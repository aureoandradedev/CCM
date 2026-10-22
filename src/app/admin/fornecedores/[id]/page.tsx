import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle, NotConfigured } from "@/components/admin/ui";
import { adminSupplierById, adminLinkedProfiles, configured } from "@/lib/admin/data";
import { maskCNPJ } from "@/lib/utils/masks";
import { SupplierLinkedUsers } from "./_linked-users";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!configured()) return <NotConfigured />;
  const { id } = await params;
  const [supplier, profiles] = await Promise.all([
    adminSupplierById(id),
    adminLinkedProfiles(id),
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
        <InfoCard label="Cidade" value={supplier.city ?? "—"} />
        <InfoCard label="Prazo de despacho" value={`${supplier.lead_time_days} dia(s) úteis`} />
        <InfoCard label="Contato" value={supplier.contact_name ?? "—"} />
        <InfoCard label="E-mail" value={supplier.contact_email ?? "—"} />
        <InfoCard label="Telefone" value={supplier.contact_phone ?? "—"} />
      </div>

      <section className="mt-8">
        <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Usuários vinculados
        </h2>
        <p className="mt-1 text-sm text-brand-ink-soft">
          Usuários que podem enviar catálogos em nome deste fornecedor.
        </p>
        <div className="mt-4">
          <SupplierLinkedUsers supplierId={supplier.id} initialProfiles={profiles} />
        </div>
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
