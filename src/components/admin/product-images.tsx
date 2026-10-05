"use client";

import Image from "next/image";
import { ArrowLeft, ImagePlus, Search, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { setProductImages } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { API_BASE, apiFetch } from "@/lib/api";
import { uploadImage } from "@/lib/admin/image-upload";

interface Candidato {
  url: string;
  score?: number;
  aceito?: boolean;
  titulo?: string;
}

/**
 * Fotos do produto: enviar do computador (WebP ≤ 1200 px no Storage),
 * buscar no QRofertas (melhor foto ou escolher entre candidatas) e ordenar.
 */
export function ProductImages({ productId, productName, initial, manual }: { productId: string; productName: string; initial: string[]; manual: boolean }) {
  const [images, setImages] = useState<string[]>(initial);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (next: string[], isManual = true) => {
    setImages(next);
    start(async () => {
      const r = await setProductImages(productId, next, isManual);
      if (r.error) toast.error(r.error);
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("upload");
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await uploadImage("produtos", productId, f));
      persist([...urls, ...images.filter((u) => !/unsplash\.com/.test(u))]);
      toast.success(`${urls.length} foto(s) enviada(s).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const buscarMelhor = async () => {
    setBusy("buscar");
    try {
      const r = await apiFetch<{ ok: boolean; url?: string; motivo?: string }>(`/imagens/produtos/${productId}/buscar`, { body: { forcar: true } });
      if (r.url) {
        setImages([r.url, ...images.filter((u) => !/unsplash\.com/.test(u) && u !== r.url)]);
        toast.success("Foto encontrada no QRofertas.");
      } else toast.error(`Sem foto: ${r.motivo ?? "não encontrada"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const listarCandidatos = async () => {
    setBusy("candidatos");
    try {
      const r = await apiFetch<{ ok: boolean; candidatos?: Candidato[]; itens?: Candidato[] }>(`/imagens/candidatos?nome=${encodeURIComponent(productName)}`);
      const lista = r.candidatos ?? r.itens ?? [];
      setCandidatos(lista);
      if (!lista.length) toast.message("Nenhuma candidata para este nome.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const usarCandidata = async (url: string) => {
    setBusy(url);
    try {
      const r = await apiFetch<{ ok: boolean; url: string }>(`/imagens/produtos/${productId}/usar-url`, { body: { url } });
      setImages([r.url, ...images.filter((u) => !/unsplash\.com/.test(u) && u !== r.url)]);
      setCandidatos(null);
      toast.success("Foto gravada.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const mover = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = images.slice();
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <Button type="button" variant="navy" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          <ImagePlus /> {busy === "upload" ? "Enviando..." : "Enviar do computador"}
        </Button>
        <Button type="button" variant="outline-navy" size="sm" onClick={buscarMelhor} disabled={busy !== null}>
          <Sparkles /> {busy === "buscar" ? "Buscando..." : "Buscar no QRofertas"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={listarCandidatos} disabled={busy !== null}>
          <Search /> {busy === "candidatos" ? "Procurando..." : "Escolher entre candidatas"}
        </Button>
        {manual ? <span className="text-xs text-brand-ink-soft">Foto manual: o lote automático não sobrescreve.</span> : null}
        {pending ? <span className="text-xs text-brand-ink-soft">Salvando...</span> : null}
      </div>

      {images.length ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {images.map((u, i) => (
            <li key={u} className="group relative aspect-square overflow-hidden rounded-xl border border-brand-line bg-white">
              <Image src={u} alt="" fill sizes="160px" className="object-contain p-1" unoptimized={/unsplash\.com/.test(u)} />
              {i === 0 ? <span className="absolute top-1 left-1 rounded bg-brand-navy px-1.5 text-[0.6rem] font-bold text-white">Principal</span> : null}
              {/unsplash\.com/.test(u) ? <span className="absolute bottom-1 left-1 rounded bg-brand-orange px-1.5 text-[0.6rem] font-bold text-white">placeholder</span> : null}
              <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {i > 0 ? (
                  <button type="button" onClick={() => mover(i, -1)} className="rounded bg-white/90 p-1 text-brand-navy shadow" aria-label="Mover para a esquerda">
                    <ArrowLeft className="size-3.5" />
                  </button>
                ) : null}
                <button type="button" onClick={() => persist(images.filter((x) => x !== u))} className="rounded bg-white/90 p-1 text-brand-red shadow" aria-label="Remover foto">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-ink-soft">Sem fotos. Envie uma ou busque no QRofertas.</p>
      )}

      {candidatos ? (
        <div className="rounded-2xl border border-brand-line bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-brand-ink">Candidatas para “{productName}”</p>
            <Button type="button" variant="ghost" size="xs" onClick={() => setCandidatos(null)}>
              Fechar
            </Button>
          </div>
          {candidatos.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {candidatos.map((c) => (
                <li key={c.url}>
                  <button type="button" onClick={() => usarCandidata(c.url)} disabled={busy !== null} className="block w-full overflow-hidden rounded-lg border border-brand-line bg-white text-left hover:border-brand-navy">
                    {/* proxy do backend: só hosts do QRofertas */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${API_BASE}/imagens/bytes?url=${encodeURIComponent(c.url)}`} alt="" className="aspect-square w-full object-contain p-1" loading="lazy" />
                    <span className="block truncate px-1 pb-1 text-[0.65rem] text-brand-ink-soft" title={c.titulo}>
                      {c.aceito ? "✓ " : ""}
                      {c.titulo ?? "usar"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-brand-ink-soft">Nenhuma candidata.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
