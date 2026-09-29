"use client";

import Image from "next/image";
import { Check, Search, Wand2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { applyOffers } from "@/app/admin/actions";
import { inputCls, textareaCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { normalize, scoreItem } from "@/lib/utils/search";
import { formatBRL } from "@/lib/utils/format";

export interface IndexItem {
  id: string;
  name: string;
  sku: string;
  brand_name: string;
  retail_price: number;
  list_price: number | null;
  images: string[];
}

interface Linha {
  texto: string;
  preco: number | null;
  sugestoes: IndexItem[];
  escolhido: string | null;
}

/** Interpreta "nome ... R$ 9,90" | "nome; 9,90" | "nome 9.90" → nome + preço. */
function parseLinha(l: string): { nome: string; preco: number | null } {
  const m = l.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)\s*$/);
  if (!m) return { nome: l.trim(), preco: null };
  const raw = m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : m[1];
  const preco = Number(raw);
  const nome = l
    .slice(0, m.index)
    .replace(/[;:\-–|]+\s*$/, "")
    .trim();
  return { nome, preco: Number.isFinite(preco) ? preco : null };
}

/** "Ofertas: colar lista" — casa cada linha com um produto (busca sem acento) e aplica preço promocional. */
export function OffersPaste({ index }: { index: IndexItem[] }) {
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(index.map((p) => [p.id, p])), [index]);

  const analisar = () => {
    const out: Linha[] = [];
    for (const raw of texto.split("\n")) {
      const l = raw.trim();
      if (!l) continue;
      const { nome, preco } = parseLinha(l);
      const pontuados = index
        .map((p) => ({ p, s: scoreItem({ id: p.id, name: p.name, brand: p.brand_name, sku: p.sku }, nome) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map((x) => x.p);
      // match exato por SKU ou nome normalizado ganha
      const exato = index.find((p) => normalize(p.sku) === normalize(nome) || normalize(p.name) === normalize(nome));
      const sugestoes = exato ? [exato, ...pontuados.filter((p) => p.id !== exato.id)] : pontuados;
      out.push({ texto: l, preco, sugestoes, escolhido: sugestoes[0]?.id ?? null });
    }
    setLinhas(out);
    if (!out.length) toast.message("Cole uma lista primeiro.");
  };

  const aplicar = () => {
    const items = linhas.filter((l) => l.escolhido && l.preco).map((l) => ({ id: l.escolhido as string, price: l.preco as number }));
    if (!items.length) return toast.error("Nenhuma linha com produto e preço.");
    start(async () => {
      const r = await applyOffers(items);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok ?? "Ofertas aplicadas.");
        setLinhas([]);
        setTexto("");
      }
    });
  };

  const prontos = linhas.filter((l) => l.escolhido && l.preco).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-brand-ink">
          Cole a lista (uma oferta por linha: nome ou SKU + preço)
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} className={`${textareaCls} mt-1 min-h-64 font-mono text-xs`} placeholder={"Cimento CP II 50kg  R$ 32,90\nARG-AC1  24,50\nTinta acrílica 18L; 189,90"} />
        </label>
        <Button variant="navy" onClick={analisar} disabled={!texto.trim()}>
          <Wand2 /> Casar com os produtos
        </Button>
        <p className="text-xs text-brand-ink-soft">O preço atual vira o preço “de” e a oferta ganha o selo. Para desfazer, use “Tirar de oferta” no produto.</p>
      </div>

      <div className="space-y-2">
        {linhas.length ? (
          <>
            {linhas.map((l, i) => {
              const esc = l.escolhido ? byId.get(l.escolhido) : null;
              return (
                <div key={i} className={`rounded-xl border p-3 text-sm ${esc && l.preco ? "border-brand-line bg-card" : "border-brand-red/40 bg-brand-red/5"}`}>
                  <p className="font-mono text-xs text-brand-ink-soft">{l.texto}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={l.escolhido ?? ""}
                      onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, escolhido: e.target.value || null } : x)))}
                      className={`${inputCls} h-9 max-w-md flex-1`}
                    >
                      <option value="">— sem correspondência —</option>
                      {l.sugestoes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.sku} · {formatBRL(s.retail_price)}
                        </option>
                      ))}
                    </select>
                    <input
                      value={l.preco ?? ""}
                      onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, preco: Number(e.target.value.replace(",", ".")) || null } : x)))}
                      className={`${inputCls} h-9 w-28`}
                      placeholder="Preço"
                      inputMode="decimal"
                    />
                    {esc ? (
                      <span className="flex items-center gap-2 text-xs text-brand-ink-soft">
                        {esc.images[0] ? <Image src={esc.images[0]} alt="" width={28} height={28} className="size-7 rounded border border-brand-line object-contain" /> : null}
                        atual {formatBRL(esc.retail_price)}
                        {l.preco && l.preco >= esc.retail_price ? <span className="font-bold text-brand-red">preço não é menor</span> : null}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-brand-red">
                        <Search className="size-3" /> escolha o produto
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-brand-line bg-card p-3 shadow-lg">
              <span className="text-sm">
                <b>{prontos}</b> de {linhas.length} linha(s) prontas
              </span>
              <Button variant="brand" onClick={aplicar} disabled={pending || !prontos}>
                <Check /> {pending ? "Aplicando..." : "Aplicar ofertas"}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-brand-line p-10 text-center text-sm text-brand-ink-soft">Cole a lista e clique em “Casar com os produtos”.</div>
        )}
      </div>
    </div>
  );
}
