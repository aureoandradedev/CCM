"use client";

import { Images } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

interface Lote {
  rodando: boolean;
  total: number;
  feitos: number;
  ok: number;
  falhas: number;
  atual: string | null;
}

/** "Buscar fotos pendentes": lote em segundo plano no backend (QRofertas). */
export function ImageBatch() {
  const [lote, setLote] = useState<Lote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lote?.rodando) return;
    const t = setInterval(async () => {
      try {
        const r = await apiFetch<{ lote: Lote }>("/imagens/lote");
        setLote(r.lote);
        if (!r.lote.rodando) toast.success(`Lote concluído: ${r.lote.ok} foto(s), ${r.lote.falhas} sem resultado.`);
      } catch {
        /* backend fora: para de perguntar */
        setLote((l) => (l ? { ...l, rodando: false } : l));
      }
    }, 3000);
    return () => clearInterval(t);
  }, [lote?.rodando]);

  const iniciar = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ lote: Lote }>("/imagens/lote", { body: { apenasSemFoto: true, limite: 200 } });
      setLote(r.lote);
      toast.message(r.lote.total ? `Buscando fotos de ${r.lote.total} produto(s)...` : "Nenhum produto sem foto real.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline-navy" size="sm" onClick={iniciar} disabled={busy || lote?.rodando}>
        <Images /> {lote?.rodando ? `Buscando ${lote.feitos}/${lote.total}...` : "Buscar fotos pendentes"}
      </Button>
      {lote?.rodando && lote.atual ? <span className="hidden max-w-[220px] truncate text-xs text-brand-ink-soft md:inline">{lote.atual}</span> : null}
    </div>
  );
}
