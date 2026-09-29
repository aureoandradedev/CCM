"use client";

import { ClipboardCopy, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { CashSummary } from "@/lib/admin/data";
import { methodLabel, paymentLabel, statusLabel } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";

const brl = (c: number) => formatBRL(c / 100);

/** Exportar CSV do dia e copiar o resumo do fechamento. */
export function CashTools({ summary }: { summary: CashSummary }) {
  const csv = () => {
    const linhas = [["Pedido", "Data", "Cliente", "Documento", "Telefone", "Forma", "Pagamento", "Status", "Total", "Fora do faturamento", "Motivo"]];
    for (const o of summary.orders) {
      linhas.push([
        o.code,
        new Date(o.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        o.customer.name,
        o.customer.document,
        o.customer.phone,
        methodLabel(o.payment_method),
        paymentLabel(o.payment_status).label,
        statusLabel(o.order_status).label,
        (o.total_centavos / 100).toFixed(2).replace(".", ","),
        o.revenue_excluded ? "sim" : "não",
        o.revenue_excluded_reason ?? "",
      ]);
    }
    const conteudo = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `caixa-${summary.day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copiar = async () => {
    const dia = new Date(`${summary.day}T12:00:00-03:00`).toLocaleDateString("pt-BR");
    const texto = [
      `*Fechamento de caixa · ${dia}*`,
      `Pedidos: ${summary.orders.length}`,
      `Vendido: ${brl(summary.vendido)}`,
      `Recebido: ${brl(summary.recebido)}`,
      `Falta receber: ${brl(summary.falta)}`,
      summary.desconsiderados ? `Desconsiderados: ${brl(summary.desconsiderados)}` : null,
      "",
      "*Por forma de pagamento*",
      ...summary.porMetodo.map((m) => `${methodLabel(m.metodo)}: ${m.qtd} · ${brl(m.total)} (recebido ${brl(m.recebido)})`),
    ]
      .filter((l) => l !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Resumo copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={copiar}>
        <ClipboardCopy /> Copiar resumo
      </Button>
      <Button variant="outline-navy" size="sm" onClick={csv} disabled={!summary.orders.length}>
        <Download /> CSV
      </Button>
    </div>
  );
}
