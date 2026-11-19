import Link from "next/link";

import { cn } from "@/lib/utils";

/** Pedaços de UI do admin (server-safe): título, cartões, tabela, campos. */

export function PageTitle({ title, subtitle, back, children }: { title: string; subtitle?: string; back?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back ? (
          <Link href={back} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink-soft hover:text-brand-navy">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5"><path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.22 8.53a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 0z" clipRule="evenodd" /></svg>
            Voltar
          </Link>
        ) : null}
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-brand-navy md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-brand-ink-soft">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Card({ className, children, title, action }: { className?: string; children: React.ReactNode; title?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-brand-line bg-card", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-brand-line px-5 py-3">
          <h2 className="font-heading text-base font-bold text-brand-navy">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "navy" }: { label: string; value: string; hint?: string; tone?: "navy" | "green" | "red" | "yellow" | "slate" }) {
  const tones = {
    navy: "text-brand-navy",
    green: "text-brand-green",
    red: "text-brand-red",
    yellow: "text-brand-orange",
    slate: "text-brand-ink-soft",
  };
  return (
    <div className="rounded-2xl border border-brand-line bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">{label}</p>
      <p className={cn("mt-1 font-heading text-2xl font-extrabold tabular-nums", tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-brand-ink-soft">{hint}</p> : null}
    </div>
  );
}

export const inputCls =
  "h-10 w-full rounded-lg border border-brand-line bg-background px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";
export const textareaCls = cn(inputCls, "h-auto min-h-24 py-2");
export const selectCls = inputCls;

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-xs font-semibold text-brand-ink", className)}>
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[0.7rem] font-normal text-brand-ink-soft">{hint}</span> : null}
    </label>
  );
}

export function Feedback({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-lg border border-brand-green/30 bg-brand-green-soft px-3 py-2 text-sm text-brand-green">{state.ok}</p>;
  return null;
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-brand-line bg-card", className)}>
      <table className="w-full min-w-[640px] text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-brand-line px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-brand-ink-soft", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("border-b border-brand-line px-3 py-2.5 align-middle", className)}>{children}</td>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-brand-line bg-card p-10 text-center text-sm text-brand-ink-soft">{children}</div>;
}

/** Filtros por link (a URL é o estado). */
export function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold whitespace-nowrap transition-colors",
        active ? "border-brand-navy bg-brand-navy text-white" : "border-brand-line bg-card text-brand-ink hover:border-brand-navy/40",
      )}
    >
      {children}
    </Link>
  );
}

export function Pagination({ page, total, perPage, href }: { page: number; total: number; perPage: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-brand-ink-soft">
      <span>
        Página {page} de {pages} · {total} registro(s)
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Chip href={href(page - 1)}>Anterior</Chip> : null}
        {page < pages ? <Chip href={href(page + 1)}>Próxima</Chip> : null}
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <Empty>
      Banco de dados não configurado. Preencha <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> e <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em <code className="rounded bg-muted px-1">.env.local</code>, rode a migration e torne seu usuário admin.
    </Empty>
  );
}
