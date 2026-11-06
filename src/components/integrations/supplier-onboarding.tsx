"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  registerSupplier,
  requestSupplierAccess,
  getOnboardingStatus,
  type OnboardingStatus,
  type SupplierRegistrationResult,
} from "@/app/fornecedores/actions";
import { isValidCNPJ, maskCNPJ, maskPhone, onlyDigits } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

type Mode = "choose" | "register" | "existing" | "pending";

interface SupplierOnboardingProps {
  onLinked: () => void;
  onBack: () => void;
}

export function SupplierOnboarding({ onLinked, onBack }: SupplierOnboardingProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOnboardingStatus().then((s) => {
      setStatus(s);
      if (s.pending) setMode("pending");
      setLoading(false);
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    const s = await getOnboardingStatus();
    setStatus(s);
    if (s.linked) {
      onLinked();
    } else if (s.pending) {
      setMode("pending");
    }
    setLoading(false);
  }, [onLinked]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-brand-ink-soft" />
      </div>
    );
  }

  if (mode === "pending" && status?.pending) {
    return (
      <PendingPanel
        supplierName={status.pending.supplierName}
        requestedAt={status.pending.requestedAt}
        onRefresh={handleRefresh}
        onBack={onBack}
        refreshing={loading}
      />
    );
  }

  if (mode === "register") {
    return (
      <RegisterForm
        onSuccess={onLinked}
        onConflict={() => setMode("existing")}
        onBack={() => setMode("choose")}
      />
    );
  }

  if (mode === "existing") {
    return (
      <ExistingForm
        onSuccess={() => handleRefresh()}
        onBack={() => setMode("choose")}
      />
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-line bg-brand-yellow-soft/30 p-6">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-navy/10 text-brand-navy">
        <Building2 className="size-6" />
      </div>
      <div className="text-center">
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Vincule sua empresa
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-soft">
          Para importar catálogos, sua conta precisa estar vinculada a uma empresa fornecedora.
        </p>
      </div>

      <div className="mx-auto grid max-w-lg gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("register")}
          className="group rounded-xl border-2 border-brand-line bg-card p-5 text-left transition-colors hover:border-brand-navy"
        >
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-brand-navy/10 text-brand-navy">
            <Building2 className="size-5" />
          </div>
          <p className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">
            Cadastrar minha empresa
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">
            Primeira vez no CCM. Informe o CNPJ e os dados da empresa.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setMode("existing")}
          className="group rounded-xl border-2 border-brand-line bg-card p-5 text-left transition-colors hover:border-brand-navy"
        >
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-brand-navy/10 text-brand-navy">
            <Search className="size-5" />
          </div>
          <p className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">
            Minha empresa já está cadastrada
          </p>
          <p className="mt-1 text-xs text-brand-ink-soft">
            Empresa já fornece para o CCM. Solicite acesso à conta.
          </p>
        </button>
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" onClick={onBack} className="gap-1 text-brand-ink-soft">
          <ArrowLeft className="size-4" /> Voltar
        </Button>
      </div>
    </div>
  );
}

/* ─── Cadastro de empresa nova ─────────────────────────────────────── */

function RegisterForm({
  onSuccess,
  onConflict,
  onBack,
}: {
  onSuccess: () => void;
  onConflict: () => void;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data = {
      cnpj: onlyDigits(fd.get("cnpj")),
      trade_name: String(fd.get("trade_name") ?? "").trim(),
      name: String(fd.get("name") ?? "").trim(),
      contact_phone: onlyDigits(fd.get("contact_phone")),
      contact_email: String(fd.get("contact_email") ?? "").trim(),
      city: String(fd.get("city") ?? "").trim(),
      state: String(fd.get("state") ?? "").trim(),
    };

    if (!isValidCNPJ(data.cnpj)) { setError("CNPJ inválido."); return; }
    if (data.trade_name.length < 3) { setError("Informe a razão social."); return; }
    if (data.name.length < 2) { setError("Informe o nome fantasia."); return; }
    if (data.contact_phone.length < 10) { setError("Telefone com DDD."); return; }
    if (data.city.length < 2) { setError("Informe a cidade."); return; }
    if (!data.state) { setError("Selecione o estado."); return; }

    setSubmitting(true);
    const result: SupplierRegistrationResult = await registerSupplier(data);
    setSubmitting(false);

    if (result.ok) {
      onSuccess();
      return;
    }
    if (result.conflict) {
      onConflict();
      return;
    }
    setError(result.error ?? "Erro inesperado.");
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-line bg-card p-6">
      <header>
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Cadastrar empresa
        </h3>
        <p className="mt-1 text-sm text-brand-ink-soft">
          Preencha os dados da sua empresa. Após o cadastro, você poderá importar catálogos imediatamente.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm font-medium text-brand-red">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-xs font-semibold text-brand-ink">
          CNPJ
          <input
            name="cnpj"
            className={cn(input, "mt-1")}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => setCnpj(maskCNPJ(onlyDigits(e.target.value)))}
            required
          />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Razão social
          <input name="trade_name" className={cn(input, "mt-1")} placeholder="Razão Social Ltda" required />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Nome fantasia
          <input name="name" className={cn(input, "mt-1")} placeholder="Nome Fantasia" required />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          Telefone comercial
          <input
            name="contact_phone"
            className={cn(input, "mt-1")}
            inputMode="tel"
            placeholder="(00) 00000-0000"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            required
          />
        </label>

        <label className="block text-xs font-semibold text-brand-ink">
          E-mail comercial
          <input name="contact_email" className={cn(input, "mt-1")} type="email" placeholder="contato@empresa.com" required />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-brand-ink">
            Cidade
            <input name="city" className={cn(input, "mt-1")} placeholder="Cidade" required />
          </label>

          <label className="block text-xs font-semibold text-brand-ink">
            Estado
            <select name="state" className={cn(input, "mt-1")} required defaultValue="">
              <option value="" disabled>UF</option>
              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onBack} className="gap-1 text-brand-ink-soft">
            <ArrowLeft className="size-4" /> Voltar
          </Button>
          <Button type="submit" variant="brand" size="lg" disabled={submitting} className="gap-1">
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" /> Cadastrando...</>
            ) : (
              <><CheckCircle2 className="size-4" /> Cadastrar empresa</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ─── Empresa já cadastrada: solicitar acesso ──────────────────────── */

function ExistingForm({
  onSuccess,
  onBack,
}: {
  onSuccess: () => void;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cnpj, setCnpj] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const digits = onlyDigits(cnpj);
    if (!isValidCNPJ(digits)) { setError("CNPJ inválido."); return; }

    setSubmitting(true);
    const result = await requestSupplierAccess(digits);
    setSubmitting(false);

    if (result.ok) {
      setSuccess(true);
      setTimeout(onSuccess, 1500);
      return;
    }
    setError(result.error ?? "Erro inesperado.");
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-line bg-card p-6">
      <header>
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Solicitar acesso
        </h3>
        <p className="mt-1 text-sm text-brand-ink-soft">
          Informe o CNPJ da sua empresa. Um administrador do CCM vai aprovar seu acesso.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm font-medium text-brand-red">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm font-medium text-brand-green">
          Solicitação enviada! Um administrador vai avaliar em breve.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-xs font-semibold text-brand-ink">
          CNPJ da empresa
          <input
            name="cnpj"
            className={cn(input, "mt-1")}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => setCnpj(maskCNPJ(onlyDigits(e.target.value)))}
            required
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onBack} className="gap-1 text-brand-ink-soft">
            <ArrowLeft className="size-4" /> Voltar
          </Button>
          <Button type="submit" variant="brand" size="lg" disabled={submitting || success} className="gap-1">
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" /> Enviando...</>
            ) : (
              <><Search className="size-4" /> Solicitar acesso</>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ─── Aguardando aprovação ─────────────────────────────────────────── */

function PendingPanel({
  supplierName,
  requestedAt,
  onRefresh,
  onBack,
  refreshing,
}: {
  supplierName: string;
  requestedAt: string;
  onRefresh: () => void;
  onBack: () => void;
  refreshing: boolean;
}) {
  const dateStr = new Date(requestedAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-4 rounded-2xl border border-brand-line bg-brand-yellow-soft/30 p-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-navy/10 text-brand-navy">
        <Clock className="size-6" />
      </div>
      <div>
        <h3 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
          Aguardando aprovação
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-soft">
          Sua solicitação de acesso a <strong className="text-brand-ink">{supplierName}</strong> foi
          enviada em {dateStr}. Um administrador do CCM vai avaliar em breve.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="brand" size="lg" onClick={onRefresh} disabled={refreshing} className="gap-1">
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Verificar status
        </Button>
        <Button variant="ghost" onClick={onBack} className="gap-1 text-brand-ink-soft">
          <ArrowLeft className="size-4" /> Voltar
        </Button>
      </div>
    </div>
  );
}
