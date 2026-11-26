"use client";

import Link from "next/link";
import { CreditCard, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { PendingPaymentOrder } from "@/lib/data/orders";
import { formatBRL } from "@/lib/utils/format";

const STORAGE_KEY = "ccm_payment_modal_seen";

function wasModalSeen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markModalSeen(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {}
}

export function PaymentPendingNotification({ orders }: { orders: PendingPaymentOrder[] }) {
  const [showModal, setShowModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (orders.length > 0 && !wasModalSeen()) {
      setShowModal(true);
    }
  }, [orders.length]);

  if (orders.length === 0) return null;

  const closeModal = () => {
    setShowModal(false);
    setDismissed(true);
    markModalSeen();
  };

  const single = orders.length === 1;
  const first = orders[0];

  if (showModal) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
        <div
          className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-card"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={closeModal}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-muted"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>

          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-brand-yellow/20">
              <CreditCard className="size-7 text-brand-navy" />
            </div>

            <div>
              <h2 className="font-heading text-lg font-bold text-brand-navy dark:text-foreground">
                {single ? "Seu pedido já foi confirmado!" : "Seus pedidos foram confirmados!"}
              </h2>
              <p className="mt-2 text-sm text-brand-ink-soft">
                {single
                  ? "Os fornecedores confirmaram a disponibilidade dos produtos. Agora falta apenas realizar o pagamento para continuarmos com seu pedido."
                  : `Você tem ${orders.length} pedidos aguardando pagamento. Finalize o pagamento para que possamos continuar com seus pedidos.`}
              </p>
            </div>

            {single ? (
              <div className="w-full rounded-xl bg-gray-50 p-4 dark:bg-muted">
                <p className="text-sm font-semibold text-brand-navy dark:text-foreground">
                  Pedido {first.code}
                </p>
                <p className="mt-1 text-lg font-bold text-brand-navy dark:text-foreground">
                  {formatBRL(first.total_centavos / 100)}
                </p>
                {!first.payment_method && (
                  <p className="mt-0.5 text-xs text-brand-ink-soft">Forma de pagamento a definir</p>
                )}
              </div>
            ) : (
              <div className="w-full space-y-2">
                {orders.slice(0, 3).map((o) => (
                  <div key={o.code} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5 dark:bg-muted">
                    <span className="text-sm font-semibold text-brand-navy dark:text-foreground">{o.code}</span>
                    <span className="text-sm font-bold text-brand-navy dark:text-foreground">
                      {formatBRL(o.total_centavos / 100)}
                    </span>
                  </div>
                ))}
                {orders.length > 3 && (
                  <p className="text-xs text-brand-ink-soft">
                    e mais {orders.length - 3} {orders.length - 3 === 1 ? "pedido" : "pedidos"}
                  </p>
                )}
              </div>
            )}

            <div className="flex w-full flex-col gap-2 sm:flex-row">
              {single ? (
                <Link
                  href={`/conta/pedidos/${first.code}`}
                  className="flex-1 rounded-xl bg-brand-navy py-3 text-center text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-navy/90"
                  onClick={closeModal}
                >
                  Pagar agora
                </Link>
              ) : (
                <Link
                  href="/conta/pedidos"
                  className="flex-1 rounded-xl bg-brand-navy py-3 text-center text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-navy/90"
                  onClick={closeModal}
                >
                  Ver pedidos
                </Link>
              )}
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 rounded-xl py-3 text-center text-sm font-semibold text-brand-ink-soft ring-1 ring-brand-line transition-colors hover:bg-gray-50 dark:hover:bg-muted"
              >
                Continuar navegando
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!dismissed && !wasModalSeen()) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="container-ccm flex items-center gap-3 py-2.5">
        <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
          {single
            ? `Seu pedido ${first.code} está aguardando pagamento.`
            : `Você tem ${orders.length} pedidos aguardando pagamento.`}
        </p>
        <Link
          href={single ? `/conta/pedidos/${first.code}` : "/conta/pedidos"}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
        >
          Finalizar pagamento
        </Link>
      </div>
    </div>
  );
}
