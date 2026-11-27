"use client";

import { useActionState, useState } from "react";
import { Package, Plus, AlertTriangle } from "lucide-react";

import { createComplementRound, type ActionResult } from "@/app/admin/actions";
import { Card, Feedback } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import type { ItemFulfillmentSummary } from "@/lib/admin/data";
import { TONE_CLASS } from "@/lib/orders";

interface Supplier {
  id: string;
  trade_name: string;
}

const STATUS_TONE: Record<string, string> = {
  aguardando_fornecedor: "orange",
  atendido: "green",
  complemento_pendente: "yellow",
  removido: "red",
};

export function ItemFulfillmentPanel({
  orderId,
  summary,
  suppliers,
}: {
  orderId: string;
  summary: ItemFulfillmentSummary;
  suppliers: Supplier[];
}) {
  const [showModal, setShowModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [state, action, pending] = useActionState<ActionResult, FormData>(createComplementRound, {});

  if (!summary.ok || summary.items.length === 0) return null;

  const hasComplement = summary.items.some((i) => i.can_complement);

  return (
    <Card title="Atendimento por item">
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line text-left text-xs text-brand-ink-soft">
                <th className="pb-2 pr-3 font-medium">Item</th>
                <th className="pb-2 pr-3 font-medium text-right">Qtd</th>
                <th className="pb-2 pr-3 font-medium text-right">CCM</th>
                <th className="pb-2 pr-3 font-medium text-right">Fornecedor</th>
                <th className="pb-2 pr-3 font-medium text-right">Aberto</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {summary.items.map((item) => {
                const tone = item.fulfillment_status ? STATUS_TONE[item.fulfillment_status] ?? "slate" : "slate";
                const toneClass = TONE_CLASS[tone] ?? TONE_CLASS.slate;
                return (
                  <tr key={item.id}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-brand-ink">{item.name}</span>
                      <span className="ml-1 text-xs text-brand-ink-soft">({item.unit})</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.qty}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.qty_ccm}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.qty_claimed}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {item.qty_open > 0 ? (
                        <span className="font-semibold text-brand-orange">{item.qty_open}</span>
                      ) : (
                        <span className="text-brand-ink-soft">0</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>
                        {item.display_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-brand-line pt-3">
          <p className="text-xs text-brand-ink-soft">
            Round atual: {summary.current_max_round}
            {summary.has_open_residual ? " · Residual aberto" : " · Totalmente atendido"}
          </p>
          {hasComplement && (
            <Button
              variant="outline"
              className="gap-1.5 text-sm"
              onClick={() => setShowModal(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Criar complemento
            </Button>
          )}
        </div>

        <Feedback state={state} />

        {showModal && (
          <div className="mt-3 rounded-lg border border-brand-line bg-brand-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-brand-blue" />
              <h4 className="text-sm font-semibold text-brand-ink">Novo round de complemento</h4>
            </div>
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <p>O complemento vai reabrir a confirmacao dos itens com residual. Se o pedido estiver aguardando pagamento, voltara para aguardando confirmacao. O resultado economico sera recalculado.</p>
              </div>
            </div>
            <form action={action}>
              <input type="hidden" name="order_id" value={orderId} />
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-brand-ink-soft" htmlFor="complement-supplier">
                  Fornecedor
                </label>
                <select
                  id="complement-supplier"
                  name="supplier_id"
                  value={selectedSupplier}
                  onChange={(e) => setSelectedSupplier(e.target.value)}
                  className="w-full rounded-md border border-brand-line bg-white px-3 py-2 text-sm"
                  required
                >
                  <option value="">Selecione...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.trade_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending || !selectedSupplier}>
                  {pending ? "Criando..." : "Criar complemento"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Card>
  );
}
