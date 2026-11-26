"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, Info, Lock, MapPin, Plus, Store, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { z } from "zod";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { useShippingConfig } from "@/lib/shipping-context";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { ApiError, apiFetch } from "@/lib/api";
import { selectLines, selectTotals, useCartStore } from "@/lib/cart/store";
import { groupCartLinesForEstimate } from "@/lib/delivery-promise";
import { formatDate } from "@/lib/orders";
import { round2 } from "@/lib/pricing";
import { formatBRL } from "@/lib/utils/format";
import type { CdPickupInfo, PublicDeliveryArea } from "@/lib/data/catalog";
import { isValidCNPJ, isValidCPF, isValidEmail, maskCEP, maskDocument, maskPhone, onlyDigits } from "@/lib/utils/masks";
import { cn } from "@/lib/utils";

const schema = z.object({
  nome: z.string().trim().min(3, "Digite seu nome completo."),
  documento: z.string().refine((v) => isValidCPF(v) || isValidCNPJ(v), "CPF ou CNPJ inválido."),
  ie: z.string().optional(),
  isento: z.boolean().optional(),
  telefone: z.string().refine((v) => onlyDigits(v).length >= 10, "Telefone com DDD."),
  email: z.string().refine(isValidEmail, "E-mail inválido."),
  entrega: z.enum(["delivery", "pickup"]),
  cep: z.string().optional(),
  rua: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  referencia: z.string().optional(),
  observacoes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-brand-red aria-invalid:ring-3 aria-invalid:ring-brand-red/15";

/** id de requisição estável por carrinho (idempotência da criação). */
function clientRequestId(assinatura: string): string {
  try {
    const raw = sessionStorage.getItem("ccm_req");
    const cur = raw ? (JSON.parse(raw) as { a: string; id: string }) : null;
    if (cur && cur.a === assinatura) return cur.id;
    const id = crypto.randomUUID();
    sessionStorage.setItem("ccm_req", JSON.stringify({ a: assinatura, id }));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

interface Perfil {
  fullName?: string;
  document?: string | null;
  phone?: string | null;
  email?: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  reference: string | null;
  is_default: boolean;
}

export interface BloqueioEntrega {
  ativo: boolean;
  data: string | null;
  mensagem: string;
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const FAIL_CLOSED_MSG = "Área de entrega temporariamente indisponível. Escolha retirada no CD ou tente novamente mais tarde.";

function validateDeliveryArea(area: PublicDeliveryArea | undefined, uf: string, city: string): string | null {
  if (!area) return FAIL_CLOSED_MSG;
  if (area.mode === "cities") {
    const allowed = area.allowedCities ?? [];
    if (allowed.length === 0) return FAIL_CLOSED_MSG;
    const normalizedAllowed = allowed.map(normalizeCity);
    if (!normalizedAllowed.includes(normalizeCity(city))) return area.rejectMessage;
    return null;
  }
  if (area.mode === "uf") {
    const allowed = area.allowedUFs ?? [];
    if (allowed.length === 0) return FAIL_CLOSED_MSG;
    if (!allowed.map((u) => u.toUpperCase()).includes(uf.trim().toUpperCase())) return area.rejectMessage;
    return null;
  }
  return FAIL_CLOSED_MSG;
}

type AddressMode = "saved" | "new";

const ADDRESS_LABELS = ["Casa", "Obra", "Empresa", "Outro"] as const;

export function CheckoutForm({ perfil, bloqueio, cdInfo, savedAddresses, deliveryArea }: { perfil?: Perfil | null; bloqueio?: BloqueioEntrega | null; cdInfo?: CdPickupInfo | null; savedAddresses?: SavedAddress[]; deliveryArea: PublicDeliveryArea }) {
  const { freeShippingFrom, standardShipping } = useShippingConfig();
  const router = useRouter();
  const hydrated = useHydrated();
  const lines = useCartStore(useShallow(selectLines));
  const totals = useCartStore(useShallow(selectTotals));
  const clear = useCartStore((s) => s.clear);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);

  const addresses = savedAddresses ?? [];
  const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0] ?? null;
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(defaultAddr?.id ?? null);
  const [addressMode, setAddressMode] = useState<AddressMode>(addresses.length > 0 ? "saved" : "new");
  const [newLabel, setNewLabel] = useState("Obra");
  const [setAsDefault, setSetAsDefault] = useState(false);

  const selectedAddress = addressMode === "saved" ? addresses.find((a) => a.id === selectedAddressId) ?? null : null;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setFocus,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entrega: bloqueio?.ativo ? "pickup" : "delivery",
      nome: perfil?.fullName ?? "",
      documento: perfil?.document ? maskDocument(perfil.document) : "",
      telefone: perfil?.phone ?? "",
      email: perfil?.email ?? "",
      cep: defaultAddr?.cep ? maskCEP(defaultAddr.cep) : "",
      rua: defaultAddr?.street ?? "",
      numero: defaultAddr?.number ?? "",
      complemento: defaultAddr?.complement ?? "",
      bairro: defaultAddr?.district ?? "",
      cidade: defaultAddr?.city ?? "",
      uf: defaultAddr?.state ?? "",
      referencia: defaultAddr?.reference ?? "",
    },
    mode: "onBlur",
  });

  const entrega = watch("entrega");
  const documento = watch("documento");
  const isento = watch("isento");
  const watchCep = watch("cep");
  const watchRua = watch("rua");
  const watchNumero = watch("numero");
  const watchBairro = watch("bairro");
  const watchCidade = watch("cidade");
  const watchUf = watch("uf");
  const isCnpj = onlyDigits(documento ?? "").length === 14 && isValidCNPJ(documento ?? "");
  const hasValidCep = onlyDigits(watchCep ?? "").length === 8;
  const hasCompleteAddress =
    hasValidCep &&
    !cepError &&
    !!watchRua?.trim() &&
    !!watchNumero?.trim() &&
    !!watchBairro?.trim() &&
    !!watchCidade?.trim() &&
    !!watchUf?.trim();

  const shipping: number | null =
    entrega === "pickup" ? 0
    : totals.subtotal >= freeShippingFrom ? 0
    : hasValidCep && !cepError ? standardShipping
    : null;
  const total = shipping !== null ? round2(totals.subtotal + shipping) : null;

  const populateFromAddress = (addr: SavedAddress) => {
    setValue("cep", maskCEP(addr.cep), { shouldValidate: true });
    setValue("rua", addr.street, { shouldValidate: true });
    setValue("numero", addr.number, { shouldValidate: true });
    setValue("complemento", addr.complement ?? "", { shouldValidate: true });
    setValue("bairro", addr.district, { shouldValidate: true });
    setValue("cidade", addr.city, { shouldValidate: true });
    setValue("uf", addr.state, { shouldValidate: true });
    setValue("referencia", addr.reference ?? "", { shouldValidate: true });
    const areaErr = validateDeliveryArea(deliveryArea, addr.state, addr.city);
    setCepError(areaErr);
  };

  const clearAddressFields = () => {
    setValue("cep", "");
    setValue("rua", "");
    setValue("numero", "");
    setValue("complemento", "");
    setValue("bairro", "");
    setValue("cidade", "");
    setValue("uf", "");
    setValue("referencia", "");
    setCepError(null);
  };

  const handleSelectAddress = (addr: SavedAddress) => {
    setSelectedAddressId(addr.id);
    setAddressMode("saved");
    populateFromAddress(addr);
  };

  const handleNewAddress = () => {
    setAddressMode("new");
    setSelectedAddressId(null);
    clearAddressFields();
  };

  const lookupCep = async (raw: string) => {
    const d = onlyDigits(raw);
    if (d.length !== 8) return;
    setCepLoading(true);
    setCepError(null);
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
      const areaError = validateDeliveryArea(deliveryArea, data.uf ?? "", data.localidade ?? "");
      if (areaError) {
        setCepError(areaError);
        return;
      }
      setFocus("numero");
    } catch {
      toast.error("Não foi possível consultar o CEP agora.");
    } finally {
      setCepLoading(false);
    }
  };

  useEffect(() => {
    if (!defaultAddr || entrega !== "delivery") return;
    if (addressMode === "saved" && selectedAddress) {
      const areaErr = validateDeliveryArea(deliveryArea, selectedAddress.state, selectedAddress.city);
      if (areaErr) setCepError(areaErr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrega]);

  const onSubmit = async (v: FormValues) => {
    if (!lines.length) {
      toast.error("Seu carrinho está vazio.");
      return;
    }
    if (v.entrega === "delivery") {
      const faltando = ["cep", "rua", "numero", "bairro", "cidade", "uf"].filter((k) => !String(v[k as keyof FormValues] || "").trim());
      if (faltando.length) {
        toast.error("Preencha o endereço de entrega completo.");
        setFocus(faltando[0] as keyof FormValues);
        return;
      }
      const submitAreaError = validateDeliveryArea(deliveryArea, String(v.uf || ""), String(v.cidade || ""));
      if (submitAreaError) {
        toast.error(submitAreaError);
        setFocus("cep");
        return;
      }
    }
    const items = lines.map((l) => ({ productId: l.productId, qty: l.qty }));
    const assinatura = onlyDigits(v.documento) + "|" + items.map((i) => `${i.productId}x${i.qty}`).sort().join(",");
    try {
      const addressPayload = v.entrega === "delivery"
        ? {
            cep: onlyDigits(v.cep),
            street: v.rua,
            number: v.numero,
            complement: v.complemento,
            district: v.bairro,
            city: v.cidade,
            state: v.uf,
            reference: v.referencia,
          }
        : undefined;
      const r = await apiFetch<{ ok: boolean; orderCode: string; accessToken?: string }>("/pagamentos/criar-pedido", {
        body: {
          items,
          customer: {
            name: v.nome,
            document: onlyDigits(v.documento),
            phone: onlyDigits(v.telefone),
            email: v.email,
            ...(isCnpj ? { ie: v.isento ? "ISENTO" : (v.ie?.trim() || undefined) } : {}),
          },
          deliveryMethod: v.entrega,
          address: addressPayload,
          addressMeta: addressPayload && addressMode === "new" ? { label: newLabel, setAsDefault } : undefined,
          notes: v.observacoes,
          clientRequestId: clientRequestId(assinatura),
          origin: "site",
        },
      });
      try { sessionStorage.removeItem("ccm_req"); } catch {}
      clear();
      toast.success("Pedido registrado! Aguarde a confirmação de disponibilidade.");
      const params = new URLSearchParams({ code: r.orderCode });
      if (r.accessToken) params.set("token", r.accessToken);
      router.push(`/checkout/sucesso?${params.toString()}`);
    } catch (e) {
      const err = e as ApiError;
      const itens = err.data?.itens as { nome?: string; erro: string; limite?: number }[] | undefined;
      if (itens?.length) {
        toast.error("Alguns itens não estão disponíveis.", { description: itens.map((i) => `${i.nome ?? i.erro}${i.limite ? ` (máx. ${i.limite})` : ""}`).join(" · ") });
      } else {
        toast.error(err.message || "Não foi possível registrar o pedido.");
      }
    }
  };

  if (hydrated && lines.length === 0) {
    return (
      <div className="container-ccm pt-6">
        <Breadcrumbs items={[{ href: "/carrinho", label: "Carrinho" }, { label: "Checkout" }]} />
        <div className="mt-6 rounded-3xl border border-dashed border-brand-line bg-card p-10 text-center">
          <p className="font-heading text-xl font-bold text-brand-navy">Seu carrinho está vazio</p>
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
      <h1 className="mt-4 font-heading text-[2rem] font-extrabold tracking-tight text-brand-navy md:mt-6 md:text-[2.6rem]">Finalizar compra</h1>

      <form onSubmit={handleSubmit(onSubmit, () => toast.error("Confira os campos destacados."))} noValidate className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Section n={1} title="Quem recebe" hint="Usamos o CPF ou CNPJ para emitir a nota fiscal.">
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
                {isCnpj ? (
                  <>
                    <Field label="Inscrição Estadual (IE)" className="sm:col-span-1">
                      <input className={cn(input, isento && "opacity-50")} disabled={!!isento} placeholder="Número da IE" {...register("ie")} />
                    </Field>
                    <label className="flex items-center gap-2 self-end pb-2.5 sm:col-span-1">
                      <input type="checkbox" className="size-4 accent-[var(--ccm-navy)]" {...register("isento")} />
                      <span className="text-sm font-medium text-brand-ink">Isento de IE</span>
                    </label>
                  </>
                ) : null}
              </div>
            </Section>

            <Section n={2} title="Entrega" hint="Entrega pela CCM ou retirada no CD da CCM.">
              {bloqueio?.ativo ? (
                <p role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-brand-orange/40 bg-brand-orange-soft px-3 py-2 text-sm text-brand-orange">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {bloqueio.mensagem || "Entregas temporariamente suspensas."}
                    {bloqueio.data ? ` Voltam em ${new Date(`${bloqueio.data}T12:00:00-03:00`).toLocaleDateString("pt-BR")}.` : ""} Retirada no CD segue normal.
                  </span>
                </p>
              ) : null}
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Forma de recebimento</legend>
                {(
                  [
                    ["delivery", "Entrega pela CCM", Truck, totals.subtotal >= freeShippingFrom ? "Frete grátis" : hasValidCep && !cepError ? `Frete ${formatBRL(standardShipping)}` : cepError ? "Fora da área de entrega" : "Informe o CEP para verificar a entrega"],
                    ["pickup", "Retirada no CD da CCM", Store, "Sem frete"],
                  ] as const
                ).map(([k, label, I, hint]) => (
                  <label key={k} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors", entrega === k ? "border-brand-navy bg-brand-yellow-soft/60" : "border-brand-line bg-card hover:border-brand-navy/30")}>
                    <input type="radio" value={k} className="size-4 accent-[var(--ccm-navy)]" disabled={k === "delivery" && bloqueio?.ativo} {...register("entrega")} />
                    <I className="size-5 text-brand-navy" />
                    <span>
                      <span className="block font-heading text-base font-bold text-brand-navy">{label}</span>
                      <span className="block text-xs text-brand-ink-soft">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {entrega === "pickup" && (cdInfo?.address || cdInfo?.hours) ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-brand-line bg-muted/50 p-4">
                  <Store className="mt-0.5 size-5 shrink-0 text-brand-navy" />
                  <div className="text-sm">
                    <p className="font-heading font-bold text-brand-navy">CD da Multigiro Central de Compras</p>
                    {cdInfo.address ? <p className="mt-0.5 text-brand-ink-soft">{cdInfo.address}{cdInfo.city ? ` — ${cdInfo.city}` : ""}{cdInfo.state ? `/${cdInfo.state}` : ""}</p> : null}
                    {cdInfo.hours ? <p className="mt-1 text-xs font-medium text-brand-ink-soft">Funcionamento: {cdInfo.hours}</p> : null}
                  </div>
                </div>
              ) : null}

              {entrega === "delivery" ? (
                <>
                  {addresses.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-soft">Endereço de entrega</p>
                      <div className="space-y-2">
                        {addresses.map((addr) => (
                          <button
                            key={addr.id}
                            type="button"
                            onClick={() => handleSelectAddress(addr)}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
                              addressMode === "saved" && selectedAddressId === addr.id
                                ? "border-brand-navy bg-brand-yellow-soft/60"
                                : "border-brand-line bg-card hover:border-brand-navy/30",
                            )}
                          >
                            <MapPin className="mt-0.5 size-4 shrink-0 text-brand-navy" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-brand-navy">{addr.label}</span>
                                {addr.is_default ? <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[0.65rem] font-semibold text-brand-navy">Padrão</span> : null}
                              </div>
                              <p className="mt-0.5 text-xs text-brand-ink-soft">
                                {addr.street}, {addr.number}{addr.complement ? ` — ${addr.complement}` : ""} · {addr.district} · {addr.city}/{addr.state} · CEP {maskCEP(addr.cep)}
                              </p>
                            </div>
                            {addressMode === "saved" && selectedAddressId === addr.id ? <Check className="mt-1 size-4 shrink-0 text-brand-navy" /> : null}
                          </button>
                        ))}

                        <button
                          type="button"
                          onClick={handleNewAddress}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-2xl border border-dashed p-3 text-left transition-colors",
                            addressMode === "new"
                              ? "border-brand-navy bg-brand-yellow-soft/60"
                              : "border-brand-line bg-card hover:border-brand-navy/30",
                          )}
                        >
                          <Plus className="size-4 text-brand-navy" />
                          <span className="text-sm font-bold text-brand-navy">Adicionar novo endereço</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {addressMode === "new" || addresses.length === 0 ? (
                    <div className={cn("grid gap-4 sm:grid-cols-6", addresses.length > 0 ? "mt-3" : "mt-4")}>
                      {addresses.length > 0 ? (
                        <div className="sm:col-span-6 grid gap-3 sm:grid-cols-2">
                          <Field label="Nome do endereço">
                            <select value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className={input}>
                              {ADDRESS_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                          </Field>
                          <label className="flex items-center gap-2 self-end pb-2.5">
                            <input type="checkbox" className="size-4 accent-[var(--ccm-navy)]" checked={setAsDefault} onChange={(e) => setSetAsDefault(e.target.checked)} />
                            <span className="text-sm font-medium text-brand-ink">Definir como endereço padrão</span>
                          </label>
                        </div>
                      ) : null}
                      <Field label="CEP" className="sm:col-span-2">
                        <input
                          className={input}
                          inputMode="numeric"
                          autoComplete="postal-code"
                          {...register("cep", {
                            onChange: (e) => {
                              const m = maskCEP(e.target.value);
                              setValue("cep", m);
                              setCepError(null);
                              if (onlyDigits(m).length === 8) void lookupCep(m);
                            },
                          })}
                        />
                        {cepLoading ? <span className="text-xs text-brand-ink-soft">Buscando endereço...</span> : null}
                        {cepError ? <span role="alert" className="text-xs font-medium text-brand-red">{cepError}</span> : null}
                      </Field>
                      <Field label="Rua / Avenida" className="sm:col-span-4">
                        <input className={input} autoComplete="address-line1" {...register("rua")} />
                      </Field>
                      <Field label="Número" className="sm:col-span-1">
                        <input className={input} {...register("numero")} />
                      </Field>
                      <Field label="Complemento" className="sm:col-span-2">
                        <input className={input} placeholder="Lote, casa, andar" {...register("complemento")} />
                      </Field>
                      <Field label="Bairro" className="sm:col-span-3">
                        <input className={input} {...register("bairro")} />
                      </Field>
                      <Field label="Cidade" className="sm:col-span-4">
                        <input className={input} autoComplete="address-level2" {...register("cidade")} />
                      </Field>
                      <Field label="UF" className="sm:col-span-2">
                        <input className={cn(input, "uppercase")} maxLength={2} autoComplete="address-level1" {...register("uf")} />
                      </Field>
                      <Field label="Ponto de referência" className="sm:col-span-6">
                        <input className={input} placeholder="Ex.: portão azul, ao lado da padaria" {...register("referencia")} />
                      </Field>
                    </div>
                  ) : addressMode === "saved" && selectedAddress ? (
                    <div className="mt-3">
                      {cepError ? <span role="alert" className="text-xs font-medium text-brand-red">{cepError}</span> : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              <Field label="Observacoes para entrega" className="mt-4">
                <input className={input} placeholder="Ex.: entregar pela manhã, obra sem portão" maxLength={500} {...register("observacoes")} />
              </Field>
            </Section>

            <div className="flex items-start gap-3 rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-4">
              <Info className="mt-0.5 size-5 shrink-0 text-brand-blue" />
              <div className="text-sm">
                <p className="font-heading font-bold text-brand-navy">Pagamento só após confirmação</p>
                <p className="mt-0.5 text-brand-ink-soft">Você não será cobrado agora. Após os fornecedores confirmarem a disponibilidade dos produtos, enviaremos um link para pagamento via Pix ou cartão.</p>
              </div>
            </div>
          </div>

          <ResumoLateral lines={lines} totals={totals} shipping={shipping} desconto={0} total={total} hydrated={hydrated}>
            <Button type="submit" variant="brand" size="xl" className="mt-5 w-full" disabled={isSubmitting || !hydrated || (entrega === "delivery" && !hasCompleteAddress)}>
              <Lock />
              {isSubmitting ? "Registrando..." : "Enviar pedido para confirmação"}
              <ArrowRight />
            </Button>
            <p className="mt-3 text-center text-[0.72rem] text-brand-ink-soft">
              Ao confirmar você aceita os{" "}
              <Link href="/termos-de-uso" className="underline">
                termos de uso
              </Link>
              .
            </p>
          </ResumoLateral>
        </form>
    </div>
  );
}

function DeliveryGroupsPreview() {
  const lines = useCartStore(useShallow(selectLines));
  const groups = useMemo(
    () => (lines.length === 0 ? [] : groupCartLinesForEstimate(lines)),
    [lines],
  );
  if (groups.length <= 1) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-brand-line pt-3">
      <p className="text-xs font-semibold text-brand-ink-soft">Previsão estimada de entregas</p>
      {groups.map((g) => (
        <div key={g.sequence} className="rounded-lg bg-muted px-3 py-2 text-xs">
          <span className="font-semibold text-brand-navy dark:text-foreground">Entrega {g.sequence}</span>
          <span className="ml-2 text-brand-ink-soft">
            {g.promisable ? `${formatDate(g.promisedFrom)} a ${formatDate(g.promisedTo)}` : "Prazo a confirmar"}
          </span>
          <span className="ml-1 text-brand-ink-soft">({g.items.length} {g.items.length === 1 ? "item" : "itens"})</span>
        </div>
      ))}
      <p className="text-[0.68rem] text-brand-ink-soft">Datas definitivas após confirmação do pedido.</p>
    </div>
  );
}

function ResumoLateral({ lines, totals, shipping, desconto, total, hydrated, children }: { lines: { productId: string; qty: number; name: string }[]; totals: { subtotal: number }; shipping: number | null; desconto: number; total: number | null; hydrated: boolean; children?: React.ReactNode }) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-3xl border border-brand-line bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-heading text-lg font-extrabold text-brand-navy">Resumo do pedido</h2>
        {hydrated ? (
          <>
            <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-sm">
              {lines.map((l) => (
                <li key={l.productId} className="line-clamp-1 text-brand-ink">
                  <span className="font-semibold">{l.qty}×</span> {l.name}
                </li>
              ))}
            </ul>
            <DeliveryGroupsPreview />
            <dl className="mt-4 space-y-2 border-t border-brand-line pt-4 text-sm">
              <div className="flex justify-between text-brand-ink-soft">
                <dt>Produtos</dt>
                <dd className="tabular-nums">{formatBRL(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-brand-ink-soft">
                <dt>Frete</dt>
                <dd>{shipping === null ? <span className="text-xs">Informe o CEP</span> : shipping === 0 ? <span className="font-semibold text-brand-green">Grátis</span> : <span className="tabular-nums">{formatBRL(shipping)}</span>}</dd>
              </div>
              {desconto > 0 ? (
                <div className="flex justify-between font-medium text-brand-green">
                  <dt>Desconto Pix</dt>
                  <dd className="tabular-nums">- {formatBRL(desconto)}</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between border-t border-brand-line pt-3">
                <dt className="font-heading text-base font-bold text-brand-navy">Total</dt>
                <dd className="font-heading text-2xl font-extrabold text-brand-navy tabular-nums">{total !== null ? formatBRL(total) : formatBRL(totals.subtotal)}</dd>
              </div>
              {total === null ? <p className="text-right text-xs text-brand-ink-soft">+ frete (informe o endereço)</p> : null}
            </dl>
          </>
        ) : (
          <div className="mt-4 h-40 animate-pulse rounded-2xl bg-muted" />
        )}
        {children}
      </div>
    </aside>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-brand-line bg-card p-5 md:p-6" aria-labelledby={`sec-${n}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-navy font-heading text-sm font-extrabold text-white">{n}</span>
        <div>
          <h2 id={`sec-${n}`} className="font-heading text-lg font-extrabold text-brand-navy">
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
