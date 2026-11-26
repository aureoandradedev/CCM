import type { Metadata } from "next";
import { Building2, MapPin, Phone, Mail, FileText } from "lucide-react";

import { assertSupplier } from "@/lib/supplier/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dados da empresa" };

export default async function SupplierDadosPage() {
  const session = await assertSupplier();
  const sb = await createClient();

  const { data: supplier } = await sb
    .from("suppliers")
    .select("id, name, trade_name, cnpj, contact_name, contact_email, contact_phone, city, state, lead_time_days")
    .eq("id", session.supplierId)
    .maybeSingle();

  if (!supplier) {
    return (
      <div>
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy">Dados da empresa</h1>
        <p className="mt-4 text-sm text-brand-ink-soft">Não foi possível carregar os dados.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy">Dados da empresa</h1>
      <p className="mt-1 text-sm text-brand-ink-soft">Informações cadastradas do fornecedor. Para alterações, entre em contato com a equipe de Compras.</p>

      <div className="mt-6 space-y-4">
        <Section title="Identificação" icon={Building2}>
          <Row label="Razão social" value={supplier.name} />
          <Row label="Nome fantasia" value={supplier.trade_name} />
          <Row label="CNPJ" value={supplier.cnpj} />
        </Section>

        <Section title="Contato" icon={Phone}>
          <Row label="Responsável" value={supplier.contact_name} />
          <Row label="E-mail" value={supplier.contact_email} />
          <Row label="Telefone" value={supplier.contact_phone} />
        </Section>

        <Section title="Localização" icon={MapPin}>
          <Row label="Cidade" value={supplier.city} />
          <Row label="Estado" value={supplier.state} />
        </Section>

        <Section title="Operação" icon={FileText}>
          <Row label="Lead time (dias)" value={supplier.lead_time_days?.toString()} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Building2; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-brand-navy" />
        <h2 className="font-heading text-base font-bold text-brand-navy">{title}</h2>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-brand-ink-soft">{label}</span>
      <span className="text-right text-sm font-medium text-brand-ink">{value || "—"}</span>
    </div>
  );
}
