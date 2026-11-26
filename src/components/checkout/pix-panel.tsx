"use client";

import { Check, Copy, QrCode, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { formatBRL } from "@/lib/utils/format";

interface PixResp {
  ok: boolean;
  orderId: string;
  orderCode: string;
  qrCodeString?: string;
  qrCodeBase64?: string;
  expiraEm?: string;
  status?: string;
  reaproveitado?: boolean;
}

/**
 * Pagamento Pix: gera o QR no backend, mostra copia-e-cola e faz polling do
 * status a cada 4 s (mesma cadência do mercado). O webhook da Cielo confirma
 * antes na maioria dos casos; o polling é o plano B.
 */
export function PixPanel({ orderId, orderCode, totalCentavos, pricingVersion, onPaid }: { orderId: string; orderCode: string; totalCentavos: number; pricingVersion: number; onPaid: () => void }) {
  const [pix, setPix] = useState<PixResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [restante, setRestante] = useState<number | null>(null);
  const [confirmarVersao, setConfirmarVersao] = useState<{ pricingVersion: number; totalCentavos: number } | null>(null);
  const paidRef = useRef(false);

  const gerar = async (confirmedPricingVersion: number) => {
    setErro(null);
    try {
      const r = await apiFetch<PixResp>("/pagamentos/pix", { body: { orderId, confirmedPricingVersion } });
      if (r.status === "pago") {
        paidRef.current = true;
        onPaid();
        return;
      }
      setPix(r);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.data.ccmShortfall === true) {
        setErro("Ajustamos seu pedido antes do pagamento. Acompanhe o status para saber quando o pagamento será liberado.");
        return;
      }
      if (err.status === 409 && typeof err.data.pricingVersion === "number") {
        setConfirmarVersao({ pricingVersion: err.data.pricingVersion as number, totalCentavos: Number(err.data.totalCentavos) });
        return;
      }
      setErro(err.message);
    }
  };

  useEffect(() => {
    // gera o QR assim que o painel abre (fora do corpo síncrono do efeito)
    const t = window.setTimeout(() => void gerar(pricingVersion), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // polling do status
  useEffect(() => {
    if (!pix) return;
    const id = window.setInterval(async () => {
      if (paidRef.current) return;
      try {
        const s = await apiFetch<{ status: string }>(`/pagamentos/pix/${orderId}/status`, { auth: false });
        if (s.status === "pago") {
          paidRef.current = true;
          window.clearInterval(id);
          onPaid();
        }
      } catch {
        /* tenta de novo no próximo tick */
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [pix, orderId, onPaid]);

  // contagem regressiva
  useEffect(() => {
    if (!pix?.expiraEm) return;
    const fim = new Date(pix.expiraEm).getTime();
    const tick = () => setRestante(Math.max(0, Math.floor((fim - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [pix?.expiraEm]);

  const copiar = async () => {
    if (!pix?.qrCodeString) return;
    try {
      await navigator.clipboard.writeText(pix.qrCodeString);
      setCopiado(true);
      toast.success("Código Pix copiado.");
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };

  if (confirmarVersao) {
    return (
      <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange-soft p-5 text-sm">
        <p className="font-semibold text-brand-navy">O valor do pedido foi atualizado para {formatBRL(confirmarVersao.totalCentavos / 100)}.</p>
        <Button variant="brand" className="mt-3" onClick={() => { setConfirmarVersao(null); void gerar(confirmarVersao.pricingVersion); }}>
          Confirmar e enviar pedido
        </Button>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-2xl border border-brand-red/30 bg-brand-red/5 p-5 text-sm">
        <p className="font-semibold text-brand-red">{erro}</p>
        <Button variant="outline" className="mt-3" onClick={() => void gerar(pricingVersion)}>
          <RefreshCw /> Tentar de novo
        </Button>
      </div>
    );
  }

  if (!pix) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-brand-ink-soft" aria-live="polite">
        <QrCode className="size-8 animate-pulse text-brand-navy" />
        Gerando QR Code…
      </div>
    );
  }

  const mm = restante !== null ? String(Math.floor(restante / 60)).padStart(2, "0") : "--";
  const ss = restante !== null ? String(restante % 60).padStart(2, "0") : "--";

  return (
    <div className="flex flex-col items-center text-center" aria-live="polite">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-ink-soft">Pedido {orderCode}</p>
      <p className="mt-1 font-heading text-3xl font-extrabold text-brand-navy">{formatBRL(totalCentavos / 100)}</p>

      <div className="mt-4 flex size-[232px] items-center justify-center rounded-2xl border border-brand-line bg-white p-2">
        {pix.qrCodeBase64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code Pix" width={216} height={216} className="size-[216px] object-contain" />
        ) : (
          <div className="px-4 text-xs text-brand-ink-soft">
            <QrCode className="mx-auto mb-2 size-10 text-brand-navy/50" />
            QR indisponível neste ambiente. Use o código copia e cola.
          </div>
        )}
      </div>

      <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-navy">
        <span className="size-2 animate-pulse rounded-full bg-brand-yellow-2" aria-hidden="true" />
        Aguardando pagamento… {restante !== null ? `expira em ${mm}:${ss}` : ""}
      </p>

      <textarea readOnly rows={3} value={pix.qrCodeString ?? ""} aria-label="Código Pix copia e cola" className="mt-3 w-full resize-none rounded-lg border border-brand-line bg-muted p-2 text-[0.7rem] text-brand-ink" />
      <Button variant="brand" size="lg" className="mt-2 w-full" onClick={copiar}>
        {copiado ? <Check /> : <Copy />}
        {copiado ? "Copiado!" : "Copiar código Pix"}
      </Button>
      <p className="mt-3 text-xs text-brand-ink-soft">Abra o app do seu banco › Pix › pague pelo QR Code ou cole o código. A confirmação é automática.</p>
    </div>
  );
}
