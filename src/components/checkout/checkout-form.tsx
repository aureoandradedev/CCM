"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Banknote, CreditCard, FileText, Info, Lock, QrCode } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { z } from "zod";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FREE_SHIPPING_FROM, STANDARD_SHIPPING } from "@/components/product/shipping-estimate";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { selectLines, selectTotals, useCartStore } from "@/lib/cart/store";
import { installmentPlan, pixPrice, round2 } from "@/lib/pricing";
import { formatBRL } from "@/lib/utils/format";
import { isValidCNPJ, isValidCPF, isValidEmail, maskCEP, maskDocument, maskPhone, onlyDigits } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const schema = z.object({
  nome: z.string().trim().min(3, "Digite seu nome completo."),
  documento: z.string().refine((v) => isValidCPF(v) || isValidCNPJ(v), "CPF ou CNPJ inválido."),
  telefone: z.string().refine((v) => onlyDigits(v).length >= 10, "Telefone com DDD."),
  email: z.string().refine(isValidEmail, "E-mail inválido."),
  cep: z.string().refine((v) => onlyDigits(v).length === 8, "CEP com 8 números."),
  rua: z.string().trim().min(2, "Informe a rua."),
  numero: z.string().trim().min(1, "Nº"),
  complemento: z.string().optional(),
  bairro: z.string().trim().min(2, "Informe o bairro."),
  cidade: z.string().trim().min(2, "Informe a cidade."),
  uf: z.string().trim().length(2, "UF"),
  referencia: z.string().optional(),
  pagamento: z.enum(["pix", "cartao", "boleto", "faturado"]),
});

type FormValues = z.infer<typeof schema>;

const PAYMENTS = [
  { value: "pix", label: "Pix", hint: "5% de desconto, aprovação na hora", icon: QrCode },
  { value: "cartao", label: "Cartão de crédito", hint: "em até 10x sem juros", icon: CreditCard },
  { value: "boleto", label: "Boleto", hint: "compensa em 1 dia útil", icon: Banknote },
  { value: "faturado", label: "Faturado (PJ)", hint: "para CNPJ com cadastro aprovado", icon: FileText },
] as const;

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-brand-red aria-invalid:ring-3 aria-invalid:ring-brand-red/15";

/**
 * Checkout de UMA página (menos fricção): identificação, entrega, pagamento e
 * resumo fixo. Por enquanto registra o pedido só no navegador; a criação no
 * Supabase + envio ao fornecedor entram na próxima fase.
 */
export function CheckoutForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const lines = useCartStore(useShallow(selectLines));
  const totals = useCartStore(useShallow(selectTotals));
  const clear = useCartStore((s) => s.clear);
  const [cepLoading, setCepLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pagamento: "pix", uf: "" },
    mode: "onBlur",
  });

  const pagamento = watch("pagamento");
  const documento = watch("documento") ?? "";
  const isPJ = onlyDigits(documento).length === 14;

  const shipping = totals.subtotal >= FREE_SHIPPING_FROM ? 0 : STANDARD_SHIPPING;
  const base = round2(totals.subtotal + shipping);
  const total = pagamento === "pix" ? pixPrice(base) : base;
  const plan = installmentPlan(base);

  const lookupCep = async (raw: string) => {
    const d = onlyDigits(raw);
    if (d.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const data = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (data.erro) {
        toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        return;
      }
      if (data.logradouro) setValue("rua", data.logradouro, { shouldValidate: true });
      if (data.bairro) setValue("bairro", data.bairro, { shouldValidate: true });
      if (data.localidade) setValue("cidade", data.localidade, { shouldValidate: true });
      if (data.uf) setValue("uf", data.uf, { shouldValidate: true });
      setFocus("numero");
    } catch {
      toast.error("Não foi possível consultar o CEP agora.");
    } finally {
      setCepLoading(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!lines.length) {
      toast.error("Seu carrinho está vazio.");
      return;
    }
    const code = `CCM-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const order = {
      code,
      createdAt: new Date().toISOString(),
      customer: { nome: values.nome, documento: onlyDigits(values.documento), telefone: onlyDigits(values.telefone), email: values.email },
      address: { cep: onlyDigits(values.cep), rua: values.rua, numero: values.numero, complemento: values.complemento, bairro: values.bairro, cidade: values.cidade, uf: values.uf.toUpperCase(), referencia: values.referencia },
      payment: values.pagamento,
      lines,
      totals: { ...totals, shipping, total },
    };
    try {
      sessionStorage.setItem(`ccm_order_${code}`, JSON.stringify(order));
    } catch {}
    // TODO (próxima fase): insert em `orders`/`order_items` no Supabase e disparo para o fornecedor.
    await new Promise((r) => setTimeout(r, 600));
    clear();
    router.push(`/checkout/sucesso?code=${code}`);
  };

  const onInvalid = () => toast.error("Confira os campos destacados.");

  if (hydrated && lines.length === 0) {
    return (
      <div className="container-ccm pt-6">
        <Breadcrumbs items={[{ href: "/carrinho", label: "Carrinho" }, { label: "Checkout" }]} />
        <div className="mt-6 rounded-3xl border border-dashed border-brand-line bg-card p-10 text-center">
          <p className="font-heading text-xl font-bold text-brand-navy dark:text-foreground">Seu carrinho está vazio</p>
          <p className="mt-1 text-sm text-brand-ink-soft">Adicione produtos antes de finalizar a compra.</p>
          <Button variant="brand" size="lg" className="mt-5" render={<Link href="/ofertas" />}>
            Ver ofertas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-ccm pt-4 md:pt-6">
      <Breadcrumbs items={[{ href: "/carrinho", label: "Carrinho" }, { label: "Finalizar compra" }]} />
      <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem] dark:text-foreground">Finalizar compra</h1>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-3 text-xs text-brand-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-blue" />
        <p>
          <strong>Ambiente de demonstração.</strong> O pedido é registrado só neste navegador. A gravação no Supabase e o envio automático ao fornecedor entram na próxima fase do projeto.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Section n={1} title="Quem recebe" hint="Usamos o CPF ou CNPJ para emitir a nota fiscal do fornecedor.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome completo" error={errors.nome?.message} className="sm:col-span-2">
                <input className={input} autoComplete="name" aria-invalid={!!errors.nome} {...register("nome")} />
              </Field>
              <Field label="CPF ou CNPJ" error={errors.documento?.message}>
                <input className={input} inputMode="numeric" aria-invalid={!!errors.documento} {...register("documento", { onChange: (e) => setValue("documento", maskDocument(e.target.value)) })} />
              </Field>
              <Field label="WhatsApp" error={errors.telefone?.message}>
                <input className={input} inputMode="tel" autoComplete="tel" aria-invalid={!!errors.telefone} {...register("telefone", { onChange: (e) => setValue("telefone", maskPhone(e.target.value)) })} />
              </Field>
              <Field label="E-mail" error={errors.email?.message} className="sm:col-span-2">
                <input className={input} type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
              </Field>
            </div>
          </Section>

          <Section n={2} title="Endereço da obra" hint="Digite o CEP e a gente preenche o resto.">
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="CEP" error={errors.cep?.message} className="sm:col-span-2">
                <input
                  className={input}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-invalid={!!errors.cep}
                  {...register("cep", {
                    onChange: (e) => {
                      const m = maskCEP(e.target.value);
                      setValue("cep", m);
                      if (onlyDigits(m).length === 8) void lookupCep(m);
                    },
                  })}
                />
                {cepLoading ? <span className="text-xs text-brand-ink-soft">Buscando endereço...</span> : null}
              </Field>
              <Field label="Rua / Avenida" error={errors.rua?.message} className="sm:col-span-4">
                <input className={input} autoComplete="address-line1" aria-invalid={!!errors.rua} {...register("rua")} />
              </Field>
              <Field label="Número" error={errors.numero?.message} className="sm:col-span-1">
                <input className={input} aria-invalid={!!errors.numero} {...register("numero")} />
              </Field>
              <Field label="Complemento" className="sm:col-span-2">
                <input className={input} placeholder="Lote, casa, andar" {...register("complemento")} />
              </Field>
              <Field label="Bairro" error={errors.bairro?.message} className="sm:col-span-3">
                <input className={input} aria-invalid={!!errors.bairro} {...register("bairro")} />
              </Field>
              <Field label="Cidade" error={errors.cidade?.message} className="sm:col-span-4">
                <input className={input} autoComplete="address-level2" aria-invalid={!!errors.cidade} {...register("cidade")} />
              </Field>
              <Field label="UF" error={errors.uf?.message} className="sm:col-span-2">
                <input className={cn(input, "uppercase")} maxLength={2} autoComplete="address-level1" aria-invalid={!!errors.uf} {...register("uf")} />
              </Field>
              <Field label="Ponto de referência" className="sm:col-span-6">
                <input className={input} placeholder="Ex.: portão azul, ao lado da padaria" {...register("referencia")} />
              </Field>
            </div>
          </Section>

          <Section n={3} title="Pagamento" hint="Você só é cobrado depois que o fornecedor confirma o pedido.">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Forma de pagamento</legend>
              {PAYMENTS.map((p) => {
                const disabled = p.value === "faturado" && !isPJ;
                const checked = pagamento === p.value;
                return (
                  <label
                    key={p.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors",
                      checked ? "border-brand-navy bg-brand-yellow-soft/60 dark:border-brand-yellow" : "border-brand-line bg-card hover:border-brand-navy/30",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input type="radio" value={p.value} disabled={disabled} className="mt-1 size-4 accent-[var(--ccm-navy)]" {...register("pagamento")} />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 font-heading text-base font-bold text-brand-navy dark:text-foreground">
                        <p.icon className="size-4" /> {p.label}
                      </span>
                      <span className="block text-xs text-brand-ink-soft">{disabled ? "Informe um CNPJ para habilitar" : p.hint}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-brand-line bg-card p-6 shadow-[var(--shadow-card)]">
            <h2 className="font-heading text-lg font-extrabold text-brand-navy dark:text-foreground">Resumo do pedido</h2>
            {hydrated ? (
              <>
                <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-sm">
                  {lines.map((l) => (
                    <li key={l.productId} className="flex justify-between gap-3">
                      <span className="line-clamp-1 text-brand-ink">
                        <span className="font-semibold">{l.qty}×</span> {l.name}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 space-y-2 border-t border-brand-line pt-4 text-sm">
                  <div className="flex justify-between text-brand-ink-soft">
                    <dt>Produtos</dt>
                    <dd className="tabular-nums">{formatBRL(totals.subtotal)}</dd>
                  </div>
                  {totals.wholesaleSavings > 0 ? (
                    <div className="flex justify-between font-medium text-brand-green">
                      <dt>Economia no atacado</dt>
                      <dd className="tabular-nums">- {formatBRL(totals.wholesaleSavings)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-brand-ink-soft">
                    <dt>Frete</dt>
                    <dd>{shipping === 0 ? <span className="font-semibold text-brand-green">Grátis</span> : formatBRL(shipping)}</dd>
                  </div>
                  {pagamento === "pix" ? (
                    <div className="flex justify-between font-medium text-brand-green">
                      <dt>Desconto Pix (5%)</dt>
                      <dd className="tabular-nums">- {formatBRL(round2(base - total))}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between border-t border-brand-line pt-3">
                    <dt className="font-heading text-base font-bold text-brand-navy dark:text-foreground">Total</dt>
                    <dd className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums dark:text-foreground">{formatBRL(total)}</dd>
                  </div>
                  {pagamento === "cartao" && plan.count > 1 ? (
                    <p className="text-right text-xs text-brand-ink-soft">
                      ou {plan.count}x de {formatBRL(plan.value)} sem juros
                    </p>
                  ) : null}
                </dl>
              </>
            ) : (
              <div className="mt-4 h-40 animate-pulse rounded-2xl bg-muted" />
            )}

            <Button type="submit" variant="brand" size="xl" className="mt-5 w-full" disabled={isSubmitting || !hydrated}>
              <Lock />
              {isSubmitting ? "Registrando..." : "Confirmar pedido"}
              <ArrowRight />
            </Button>
            <p className="mt-3 text-center text-[0.72rem] text-brand-ink-soft">
              Ao confirmar você aceita os{" "}
              <Link href="/termos-de-uso" className="underline">
                termos de uso
              </Link>
              .
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-brand-line bg-card p-5 md:p-6" aria-labelledby={`sec-${n}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-navy font-heading text-sm font-extrabold text-white dark:bg-brand-yellow dark:text-brand-navy">{n}</span>
        <div>
          <h2 id={`sec-${n}`} className="font-heading text-lg font-extrabold text-brand-navy dark:text-foreground">
            {title}
          </h2>
          {hint ? <p className="text-xs text-brand-ink-soft">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-semibold text-brand-ink">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-medium text-brand-red">
          {error}
        </span>
      ) : null}
    </label>
  );
}
