"use client";

import Image from "next/image";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteBanner, saveAviso, saveBanner, saveBestSellers, saveBloqueio, type ActionResult } from "@/app/admin/actions";
import type { IndexItem } from "@/components/admin/offers-paste";
import { Feedback, Field, inputCls, selectCls, textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { uploadImage } from "@/lib/admin/image-upload";
import type { AdminBanner, BloqueioSettings } from "@/lib/admin/types";
import { normalize } from "@/lib/utils/search";

/* ------------------------------ banners --------------------------------- */

export function BannerForm({ banner, onDone }: { banner: AdminBanner | null; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveBanner, {});
  const [image, setImage] = useState(banner?.image ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      setImage(await uploadImage("banners", "home", f));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      action={(fd) => {
        action(fd);
        onDone?.();
      }}
      className="grid gap-3 rounded-2xl border border-brand-line bg-card p-4 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={banner?.id ?? ""} />
      <input type="hidden" name="image" value={image} />
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <div className="sm:col-span-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="flex items-center gap-3">
          {image ? <Image src={image} alt="" width={240} height={90} className="h-20 w-auto rounded-lg border border-brand-line object-cover" /> : <span className="flex h-20 w-48 items-center justify-center rounded-lg border border-dashed border-brand-line text-xs text-brand-ink-soft">sem imagem</span>}
          <Button type="button" variant="outline-navy" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <ImagePlus /> {uploading ? "Enviando..." : image ? "Trocar imagem" : "Enviar imagem"}
          </Button>
        </div>
      </div>
      <Field label="Chamada pequena (eyebrow)">
        <input name="eyebrow" defaultValue={banner?.eyebrow ?? ""} className={inputCls} />
      </Field>
      <Field label="Título">
        <input name="title" defaultValue={banner?.title ?? ""} className={inputCls} required />
      </Field>
      <Field label="Subtítulo" className="sm:col-span-2">
        <input name="subtitle" defaultValue={banner?.subtitle ?? ""} className={inputCls} />
      </Field>
      <Field label="Texto do botão">
        <input name="cta" defaultValue={banner?.cta ?? "Ver ofertas"} className={inputCls} />
      </Field>
      <Field label="Link (destino)">
        <input name="href" defaultValue={banner?.href ?? "/ofertas"} className={inputCls} />
      </Field>
      <Field label="Tema">
        <select name="theme" defaultValue={banner?.theme ?? "navy"} className={selectCls}>
          <option value="navy">Azul</option>
          <option value="yellow">Amarelo</option>
          <option value="orange">Laranja</option>
          <option value="dark">Escuro</option>
        </select>
      </Field>
      <Field label="Imagem">
        <select name="variant" defaultValue={banner?.variant ?? "photo"} className={selectCls}>
          <option value="photo">Foto cobrindo a direita</option>
          <option value="mascot">Mascote recortado (PNG)</option>
        </select>
      </Field>
      <Field label="Ordem">
        <input name="sort" defaultValue={banner?.sort ?? 0} className={inputCls} inputMode="numeric" />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={banner?.active ?? true} className="size-4 accent-brand-navy" /> Ativo
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="brand" disabled={pending || !image}>
          {pending ? "Salvando..." : "Salvar banner"}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Fechar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function BannerList({ banners }: { banners: AdminBanner[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {banners.map((b) => (
        <div key={b.id} className="rounded-2xl border border-brand-line bg-card p-3">
          <div className="flex items-center gap-3">
            <Image src={b.image} alt="" width={160} height={60} className="h-14 w-24 rounded-lg border border-brand-line object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-brand-ink">{b.title}</p>
              <p className="text-xs text-brand-ink-soft">
                {b.href} · ordem {b.sort} · {b.active ? "ativo" : "inativo"}
                {b.campaign_id ? " · campanha" : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing(editing === b.id ? null : b.id)}>
              {editing === b.id ? "Fechar" : "Editar"}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-brand-red"
              disabled={pending}
              onClick={() =>
                window.confirm(`Excluir o banner "${b.title}"?`) &&
                start(async () => {
                  const r = await deleteBanner(b.id);
                  if (r.error) toast.error(r.error);
                  else toast.success(r.ok ?? "Excluído.");
                })
              }
              aria-label="Excluir"
            >
              <Trash2 />
            </Button>
          </div>
          {editing === b.id ? (
            <div className="mt-3">
              <BannerForm banner={b} onDone={() => setEditing(null)} />
            </div>
          ) : null}
        </div>
      ))}
      {novo ? (
        <BannerForm banner={null} onDone={() => setNovo(false)} />
      ) : (
        <Button variant="navy" size="sm" onClick={() => setNovo(true)}>
          <Plus /> Novo banner
        </Button>
      )}
    </div>
  );
}

/* --------------------------- bloqueio / aviso ---------------------------- */

export function BloqueioForm({ value }: { value: BloqueioSettings }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveBloqueio, {});
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={value.ativo} className="size-4 accent-brand-navy" /> Bloquear novas entregas (avisar no checkout)
      </label>
      <Field label="Entregas voltam em (data)" hint="Vazio = sem data definida.">
        <input type="date" name="data" defaultValue={value.data ?? ""} className={inputCls} />
      </Field>
      <Field label="Mensagem ao cliente">
        <textarea name="mensagem" defaultValue={value.mensagem ?? ""} className={textareaCls} rows={2} placeholder="Ex.: Estamos com a agenda de entregas cheia. Retirada segue normal." />
      </Field>
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

export function AvisoForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveAviso, {});
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <Field label="Aviso na barra do topo" hint="Vazio = mostra os avisos padrão (frete, Pix, atacado).">
        <input name="topo" defaultValue={value} className={inputCls} placeholder="Ex.: Black Friday: até 40% em pisos até domingo" />
      </Field>
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

/* ----------------------------- mais vendidos ----------------------------- */

export function BestSellersForm({ ids, index }: { ids: string[]; index: IndexItem[] }) {
  const [lista, setLista] = useState<string[]>(ids);
  const [busca, setBusca] = useState("");
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(index.map((p) => [p.id, p])), [index]);
  const resultados = useMemo(() => {
    const q = normalize(busca);
    if (q.length < 2) return [];
    return index.filter((p) => !lista.includes(p.id) && (normalize(p.name).includes(q) || normalize(p.sku) === q)).slice(0, 8);
  }, [busca, index, lista]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-brand-ink-soft">Escolha à mão quais produtos aparecem na vitrine “Mais vendidos” da home (em ordem). Vazio = automático pelos selos.</p>
      <div className="relative">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} className={inputCls} placeholder="Buscar produto para adicionar" />
        {resultados.length ? (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-brand-line bg-popover shadow-lg">
            {resultados.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { setLista([...lista, p.id]); setBusca(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className="flex-1 truncate">{p.name}</span>
                  <Plus className="size-4 text-brand-navy" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ol className="space-y-1 text-sm">
        {lista.map((id, i) => {
          const p = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-2 rounded-lg border border-brand-line px-3 py-1.5">
              <span className="w-5 text-xs text-brand-ink-soft">{i + 1}.</span>
              <span className="flex-1 truncate">{p?.name ?? id}</span>
              <button type="button" onClick={() => setLista(lista.filter((x) => x !== id))} className="text-brand-red" aria-label="Remover">
                <X className="size-4" />
              </button>
            </li>
          );
        })}
      </ol>
      <Button
        variant="navy"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveBestSellers(lista);
            if (r.error) toast.error(r.error);
            else toast.success(r.ok ?? "Salvo.");
          })
        }
      >
        {pending ? "Salvando..." : "Salvar mais vendidos"}
      </Button>
    </div>
  );
}
