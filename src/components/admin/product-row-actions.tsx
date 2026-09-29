"use client";

import Link from "next/link";
import { Copy, Eye, EyeOff, Pencil, TagIcon, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteProduct, duplicateProduct, removeOffer, toggleProductActive, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminProduct } from "@/lib/admin/types";

export function ProductRowActions({ product, compact = true }: { product: Pick<AdminProduct, "id" | "slug" | "active" | "list_price" | "name">; compact?: boolean }) {
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.success(r.ok);
    });
  const size = compact ? "icon-sm" : "sm";
  return (
    <div className={compact ? "flex items-center gap-1" : "flex flex-wrap gap-2"}>
      {compact ? (
        <Button variant="ghost" size="icon-sm" render={<Link href={`/admin/produtos/${product.id}`} />} title="Editar">
          <Pencil />
        </Button>
      ) : null}
      <Button variant="ghost" size={size} render={<Link href={`/produto/${product.slug}`} target="_blank" />} title="Ver na loja">
        <Eye /> {compact ? null : "Ver na loja"}
      </Button>
      <Button variant="ghost" size={size} disabled={pending} onClick={() => go(() => toggleProductActive(product.id, !product.active))} title={product.active ? "Desativar" : "Ativar"}>
        {product.active ? <EyeOff /> : <Eye className="text-brand-green" />} {compact ? null : product.active ? "Desativar" : "Ativar"}
      </Button>
      {product.list_price ? (
        <Button variant="ghost" size={size} disabled={pending} onClick={() => go(() => removeOffer(product.id))} title="Tirar de oferta">
          <TagIcon className="text-brand-orange" /> {compact ? null : "Tirar de oferta"}
        </Button>
      ) : null}
      <Button variant="ghost" size={size} disabled={pending} onClick={() => go(() => duplicateProduct(product.id))} title="Duplicar">
        <Copy /> {compact ? null : "Duplicar"}
      </Button>
      <Button
        variant="ghost"
        size={size}
        disabled={pending}
        className="text-brand-red"
        onClick={() => {
          if (window.confirm(`Excluir "${product.name}"? Se tiver pedidos, será só desativado.`)) go(() => deleteProduct(product.id));
        }}
        title="Excluir"
      >
        <Trash2 /> {compact ? null : "Excluir"}
      </Button>
    </div>
  );
}
