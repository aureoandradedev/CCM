"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { saveCampaign } from "@/app/admin/actions";
import type { IndexItem } from "@/components/admin/offers-paste";
import { inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { uploadImage } from "@/lib/admin/image-upload";
import type { AdminCampaign, CampaignProduct } from "@/lib/admin/types";
import { normalize } from "@/lib/utils/search";
import { formatBRL } from "@/lib/utils/format";

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CampaignForm({ campaign, index }: { campaign: AdminCampaign | null; index: IndexItem[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(campaign?.title ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(campaign?.starts_at));
  const [products, setProducts] = useState<CampaignProduct[]>(campaign?.products ?? []);
  const [banners, setBanners] = useState<{ image: string; sort: number }[]>(campaign?.banners ?? []);
  const [busca, setBusca] = useState("");
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editavel = !campaign || campaign.status === "agendada";

  const resultados = useMemo(() => {
    const q = normalize(busca);
    if (q.length < 2) return [];
    return index.filter((p) => normalize(p.name).includes(q) || normalize(p.sku) === q).slice(0, 8);
  }, [busca, index]);

  const add = (p: IndexItem) => {
    if (products.some((x) => x.product_id === p.id)) return;
    setProducts([...products, { product_id: p.id, name: p.name, price: Math.round(p.retail_price * 0.9 * 100) / 100 }]);
    setBusca("");
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const novos: { image: string; sort: number }[] = [];
      for (const f of Array.from(files)) novos.push({ image: await uploadImage("banners", `campanhas/${campaign?.id ?? "nova"}`, f), sort: banners.length + novos.length });
      setBanners([...banners, ...novos]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const salvar = () =>
    start(async () => {
      const r = await saveCampaign({ id: campaign?.id, title, starts_at: startsAt, products, banners });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Salvo.");
      if (!campaign && r.id) router.push(`/admin/campanhas/${r.id}`);
      else router.refresh();
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="grid gap-4 rounded-2xl border border-brand-line bg-card p-5 sm:grid-cols-[1fr_220px]">
          <label className="block text-xs font-semibold text-brand-ink">
            Título da campanha
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-1`} disabled={!editavel} placeholder="Ex.: Semana do Piso" />
          </label>
          <label className="block text-xs font-semibold text-brand-ink">
            Início
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={`${inputCls} mt-1`} disabled={!editavel} />
          </label>
        </div>

        <div className="rounded-2xl border border-brand-line bg-card p-5">
          <p className="font-heading font-bold text-brand-navy">Produtos e preços promocionais</p>
          {editavel ? (
            <div className="relative mt-2">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} className={inputCls} placeholder="Buscar produto por nome ou SKU para adicionar" />
              {resultados.length ? (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-brand-line bg-popover shadow-lg">
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => add(p)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                        {p.images[0] ? <Image src={p.images[0]} alt="" width={28} height={28} className="size-7 rounded object-contain" /> : null}
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-brand-ink-soft">{formatBRL(p.retail_price)}</span>
                        <Plus className="size-4 text-brand-navy" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <ul className="mt-3 divide-y divide-brand-line text-sm">
            {products.map((it, i) => (
              <li key={it.product_id} className="flex items-center gap-3 py-2">
                <span className="flex-1 truncate">{it.name}</span>
                {it.original_price ? <span className="text-xs text-brand-ink-soft line-through">{formatBRL(it.original_price)}</span> : null}
                <input
                  value={it.price}
                  onChange={(e) => setProducts(products.map((x, j) => (j === i ? { ...x, price: Number(e.target.value.replace(",", ".")) || 0 } : x)))}
                  className={`${inputCls} h-9 w-28 text-right`}
                  inputMode="decimal"
                  disabled={!editavel}
                />
                {editavel ? (
                  <button type="button" onClick={() => setProducts(products.filter((_, j) => j !== i))} className="text-brand-red" aria-label="Remover">
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
            {!products.length ? <li className="py-4 text-center text-brand-ink-soft">Nenhum produto ainda.</li> : null}
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-brand-line bg-card p-5">
          <p className="font-heading font-bold text-brand-navy">Banners da campanha</p>
          <p className="mt-1 text-xs text-brand-ink-soft">Substituem o carrossel da home enquanto a campanha estiver ativa. Ideal 1600×600.</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          {editavel ? (
            <Button type="button" variant="outline-navy" size="sm" className="mt-3" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <ImagePlus /> {uploading ? "Enviando..." : "Enviar banner"}
            </Button>
          ) : null}
          <ul className="mt-3 space-y-2">
            {banners.map((b, i) => (
              <li key={b.image} className="relative overflow-hidden rounded-xl border border-brand-line">
                <Image src={b.image} alt="" width={640} height={240} className="aspect-[8/3] w-full object-cover" />
                {editavel ? (
                  <button type="button" onClick={() => setBanners(banners.filter((_, j) => j !== i))} className="absolute top-1 right-1 rounded bg-white/90 p-1 text-brand-red shadow" aria-label="Remover banner">
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {editavel ? (
          <Button variant="brand" size="lg" className="w-full" onClick={salvar} disabled={pending}>
            {pending ? "Salvando..." : campaign ? "Salvar campanha" : "Criar campanha"}
          </Button>
        ) : (
          <p className="text-sm text-brand-ink-soft">Campanha {campaign.status}: não pode mais ser editada.</p>
        )}
      </div>
    </div>
  );
}
