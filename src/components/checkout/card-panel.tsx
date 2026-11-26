"use client";

import { CreditCard, Lock } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { collectCardFields, maskCardNumber, maskCvv, maskExpiry, processCard, type CardTipo } from "@/lib/payments/card-core";
import { formatBRL } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const input =
  "h-11 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink outline-none transition-colors placeholder:text-brand-ink-soft/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Pagamento com cartão: mesmo fluxo do mercado (Silent Order Post + 3DS no
 * débito). Os hidden bp-sop-* / bpmpi_* abaixo são lidos pelos scripts da Cielo.
 */
export function CardPanel({ orderId, orderCode, totalCentavos, pricingVersion, onPaid }: { orderId: string; orderCode: string; totalCentavos: number; pricingVersion: number; onPaid: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tipo, setTipo] = useState<CardTipo>("credito");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const busy = useRef(false); // guarda de reentrância: duplo clique consumiria 2 tokens
  const [pending, setPending] = useState(false);
  const versao = useRef(pricingVersion); // 409: servidor manda a versão nova, o próximo clique confirma

  const pagar = async () => {
    const confirmedPricingVersion = versao.current;
    if (busy.current) return;
    const campos = collectCardFields({ holder, number, expiry, cvv });
    if (!campos.ok) {
      setErro(campos.msg);
      return;
    }
    busy.current = true;
    setPending(true);
    setErro(null);
    try {
      const r = await processCard({
        root: rootRef.current!,
        tipo,
        campos: campos.campos,
        numeroDigits: campos.numeroDigits,
        mes: campos.mes,
        ano: campos.ano,
        orderNumber: orderId,
        onStatus: setStatus,
      });
      setStatus("Processando o pagamento…");
      await apiFetch("/pagamentos/cartao", {
        body: { orderId, tipo: r.tipo, paymentToken: r.paymentToken, brand: r.brand, dados3ds: r.dados3ds ?? undefined, confirmedPricingVersion },
      });
      setStatus("Pagamento aprovado!");
      onPaid();
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.status === 409 && err.data.ccmShortfall === true) {
        setErro("Ajustamos seu pedido antes do pagamento. Acompanhe o status para saber quando o pagamento será liberado.");
      } else if (err instanceof ApiError && err.status === 409 && typeof err.data.pricingVersion === "number") {
        setErro(`O valor foi atualizado para ${formatBRL(Number(err.data.totalCentavos) / 100)}. Clique em pagar de novo para confirmar.`);
        versao.current = err.data.pricingVersion as number;
      } else if (err instanceof ApiError && err.status === 402) {
        setErro("Pagamento não autorizado pela operadora. Confira os dados ou use outro cartão.");
      } else {
        setErro(err.message || "Não foi possível concluir o pagamento.");
      }
      setStatus(null);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div ref={rootRef}>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Pedido {orderCode}</p>
        <p className="font-heading text-2xl font-extrabold text-brand-navy">{formatBRL(totalCentavos / 100)}</p>
      </div>

      <fieldset className="mt-4 grid grid-cols-2 gap-2">
        <legend className="sr-only">Tipo de cartão</legend>
        {(["credito", "debito"] as CardTipo[]).map((t) => (
          <label key={t} className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors", tipo === t ? "border-brand-navy bg-brand-yellow-soft/60 text-brand-navy" : "border-brand-line bg-card text-brand-ink hover:border-brand-navy/30")}>
            <input type="radio" name="cardTipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="sr-only" />
            <CreditCard className="size-4" />
            {t === "credito" ? "Crédito" : "Débito"}
          </label>
        ))}
      </fieldset>

      <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold text-brand-ink">
          Nome no cartão
          <input id="cardHolder" className={cn(input, "mt-1")} autoComplete="cc-name" placeholder="Como está no cartão" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-brand-ink">
          Número do cartão
          <input id="cardNumber" className={cn(input, "mt-1")} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" maxLength={23} value={number} onChange={(e) => setNumber(maskCardNumber(e.target.value))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-brand-ink">
            Validade (MM/AA)
            <input id="cardExpiry" className={cn(input, "mt-1")} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" maxLength={5} value={expiry} onChange={(e) => setExpiry(maskExpiry(e.target.value, (e.nativeEvent as InputEvent).inputType === "deleteContentBackward"))} />
          </label>
          <label className="block text-xs font-semibold text-brand-ink">
            CVV
            <input id="cardCvv" className={cn(input, "mt-1")} inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={cvv} onChange={(e) => setCvv(maskCvv(e.target.value))} />
          </label>
        </div>
      </div>

      {/* Hidden lidos pelo SOP (por classe), preenchidos já normalizados. Classes EXATAS do script. */}
      <input type="hidden" className="bp-sop-cardholdername" />
      <input type="hidden" className="bp-sop-cardnumber" />
      <input type="hidden" className="bp-sop-cardexpirationdate" />
      <input type="hidden" className="bp-sop-cardcvv" />
      <input type="hidden" className="bp-sop-cardtype" />
      {/* Hidden lidos pelo script 3DS (débito). */}
      <input type="hidden" className="bpmpi_auth" defaultValue="true" />
      <input type="hidden" className="bpmpi_device_channel" defaultValue="Browser" />
      <input type="hidden" className="bpmpi_merchant_url" defaultValue={process.env.NEXT_PUBLIC_SITE_URL ?? "https://ccm.multigiroatacadao.com.br"} />
      <input type="hidden" className="bpmpi_accesstoken" />
      <input type="hidden" className="bpmpi_ordernumber" />
      <input type="hidden" className="bpmpi_currency" defaultValue="BRL" />
      <input type="hidden" className="bpmpi_totalamount" />
      <input type="hidden" className="bpmpi_installments" defaultValue="1" />
      <input type="hidden" className="bpmpi_paymentmethod" defaultValue="Debit" />
      <input type="hidden" className="bpmpi_cardnumber" />
      <input type="hidden" className="bpmpi_cardexpirationmonth" />
      <input type="hidden" className="bpmpi_cardexpirationyear" />

      {erro ? (
        <p role="alert" className="mt-4 rounded-lg border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-sm text-brand-red">
          {erro}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mt-4 text-sm font-semibold text-brand-navy">
          {status}
        </p>
      ) : null}

      <Button variant="brand" size="xl" className="mt-4 w-full" onClick={() => void pagar()} disabled={pending}>
        <Lock />
        {pending ? "Processando…" : `Pagar ${formatBRL(totalCentavos / 100)}`}
      </Button>
      <p className="mt-3 text-center text-xs text-brand-ink-soft">Os dados do cartão vão direto e criptografados para a Cielo. Não passam pelo nosso servidor.</p>
    </div>
  );
}
