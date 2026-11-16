"use client";

import Link from "next/link";
import { Check, Copy, LinkIcon, Pencil, Plus, Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { createSupplierInvite } from "@/app/admin/fornecedores/invite-actions";

import { EditableList } from "@/components/admin/editable-list";
import { CategoryForm, SupplierForm } from "@/components/admin/settings-forms";
import { inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AdminCategory, AdminSupplier } from "@/lib/admin/types";
import type { SupplierListSummary } from "@/lib/admin/supplier-bi-data";
import { maskCNPJ } from "@/lib/utils/masks";

function SupplierStatusBadge({ supplier, hasActiveTerms }: { supplier: AdminSupplier; hasActiveTerms: boolean }) {
  if (!supplier.active) {
    return <span className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-bold text-brand-ink-soft">Inativo</span>;
  }
  if (hasActiveTerms) {
    return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-green-800 dark:bg-green-900/30 dark:text-green-400">Operacional</span>;
  }
  return <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Cadastro incompleto</span>;
}

function NewSupplierDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="navy" size="sm" />}>
        <Plus className="size-4" /> Novo fornecedor
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>Preencha os dados cadastrais. Condições comerciais são definidas na ficha.</DialogDescription>
        </DialogHeader>
        <SupplierForm supplier={null} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteSupplierDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    startTransition(async () => {
      setError(null);
      setInviteUrl(null);
      const result = await createSupplierInvite();
      if (result.error) setError(result.error);
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
    });
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setInviteUrl(null); setError(null); setCopied(false); } }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <LinkIcon className="size-4" /> Convidar fornecedor
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convidar fornecedor</DialogTitle>
          <DialogDescription>Gere um link de cadastro para enviar ao fornecedor. O link expira em 7 dias e pode ser usado uma única vez.</DialogDescription>
        </DialogHeader>
        {!inviteUrl ? (
          <div className="space-y-3">
            {error ? <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p> : null}
            <Button variant="navy" onClick={handleGenerate} disabled={pending}>
              {pending ? "Gerando..." : "Gerar link de convite"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-green-700 dark:text-green-400">Link gerado! Copie e envie ao fornecedor.</p>
            <div className="flex gap-2">
              <input readOnly value={inviteUrl} className="h-9 flex-1 rounded-lg border border-brand-line bg-muted px-3 text-xs outline-none" />
              <Button variant="navy" size="sm" onClick={handleCopy}>
                {copied ? <><Check className="size-3.5" /> Copiado</> : <><Copy className="size-3.5" /> Copiar</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const digits = (s: string) => s.replace(/\D/g, "");

function matchesSearch(s: AdminSupplier, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  if (s.name.toLowerCase().includes(lower)) return true;
  if (s.trade_name?.toLowerCase().includes(lower)) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 3 && s.cnpj && digits(s.cnpj).includes(qDigits)) return true;
  if (s.cnpj?.toLowerCase().includes(lower)) return true;
  return false;
}

function fmtBrl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function SuppliersAdmin({ suppliers, supplierIdsWithTerms, summaries = {} }: { suppliers: AdminSupplier[]; supplierIdsWithTerms: string[]; summaries?: Record<string, SupplierListSummary> }) {
  const termsSet = new Set(supplierIdsWithTerms);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => suppliers.filter((s) => matchesSearch(s, query.trim())), [suppliers, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NewSupplierDialog />
        <InviteSupplierDialog />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input
            type="search"
            placeholder="Buscar por nome, razão social ou CNPJ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputCls} pl-9`}
          />
        </div>
      </div>
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-brand-line bg-card p-6 text-center text-sm text-brand-ink-soft">
            {query.trim() ? `Nenhum fornecedor encontrado para "${query.trim()}".` : "Nenhum fornecedor cadastrado."}
          </p>
        ) : (
          filtered.map((s) => {
            const kpi = summaries[s.id];
            return (
              <div key={s.id} className="rounded-2xl border border-brand-line bg-card p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/fornecedores/${s.id}`} className="font-semibold text-brand-navy hover:underline dark:text-foreground">
                        {s.name}
                      </Link>
                      <SupplierStatusBadge supplier={s} hasActiveTerms={termsSet.has(s.id)} />
                    </div>
                    <p className="text-xs text-brand-ink-soft">
                      {s.city ?? "—"} · despacho {s.lead_time_days} dia(s) · {s.cnpj ? maskCNPJ(s.cnpj) : "sem CNPJ"} · {s.contact_name ?? ""} {s.contact_phone ?? ""}
                    </p>
                    {kpi && (
                      <div className="mt-1.5 flex flex-wrap gap-3 text-[0.65rem] font-semibold tabular-nums text-brand-ink-soft">
                        <span title="Faturamento 30 dias">Fat. 30d: <span className="text-brand-navy">{fmtBrl(kpi.faturamento30d)}</span></span>
                        <span title="Unidades vendidas 30 dias">Un. 30d: <span className="text-brand-navy">{kpi.unidades30d}</span></span>
                        <span title="Produtos com oferta ativa">Prod. ativos: <span className="text-brand-navy">{kpi.produtosAtivos}</span></span>
                        {kpi.ultimaVenda && (
                          <span title="Última venda">Últ. venda: <span className="text-brand-navy">{new Date(kpi.ultimaVenda).toLocaleDateString("pt-BR")}</span></span>
                        )}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/admin/fornecedores/${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-ink-soft transition-colors hover:border-brand-navy hover:text-brand-navy"
                  >
                    <Pencil className="size-3" /> Editar
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function CategoriesAdmin({ categories }: { categories: AdminCategory[] }) {
  return (
    <EditableList
      items={categories.map((c) => ({ ...c, key: c.slug }))}
      newLabel="Nova categoria"
      renderRow={(c) => (
        <>
          <p className="font-semibold text-brand-ink">
            {c.name} <span className="text-xs font-normal text-brand-ink-soft">/{c.slug}</span>
            {!c.active ? <span className="ml-1 rounded bg-muted px-1 text-[0.65rem] font-bold">INATIVA</span> : null}
          </p>
          <p className="truncate text-xs text-brand-ink-soft">{c.subcategories.map((s) => s.name).join(" · ") || "sem subcategorias"}</p>
        </>
      )}
      renderForm={(c, done) => <CategoryForm category={c} onDone={done} />}
    />
  );
}
