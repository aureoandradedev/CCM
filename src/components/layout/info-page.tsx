import { Breadcrumbs } from "@/components/layout/breadcrumbs";

/** Molde das páginas institucionais (como funciona, fornecedores, profissionais...). */
export function InfoPage({ eyebrow, title, intro, crumb, children }: { eyebrow?: string; title: string; intro?: string; crumb: string; children: React.ReactNode }) {
  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ label: crumb }]} />
      <header className="mt-4 max-w-3xl md:mt-6">
        {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-orange">{eyebrow}</p> : null}
        <h1 className="mt-1 font-heading text-[2.1rem] leading-[1.02] font-extrabold tracking-tight text-brand-navy md:text-[2.8rem] dark:text-foreground">{title}</h1>
        {intro ? <p className="mt-4 text-[0.98rem] leading-relaxed text-brand-ink-soft">{intro}</p> : null}
      </header>
      <div className="mt-8 space-y-8">{children}</div>
    </div>
  );
}

export function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-brand-line bg-card p-6 md:p-8">
      <h2 className="font-heading text-xl font-extrabold text-brand-navy dark:text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.95rem] leading-relaxed text-brand-ink">{children}</div>
    </section>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-brand-line">
      {items.map((it) => (
        <details key={it.q} className="group py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-brand-ink [&::-webkit-details-marker]:hidden">
            {it.q}
            <span className="text-brand-ink-soft transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-brand-ink-soft">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
