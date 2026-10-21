"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Grid2x2, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { formatBRL } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface Suggestion {
  products: { id: string; slug: string; name: string; brand: string; image: string; retailPrice: number }[];
  categories: { slug: string; name: string }[];
}

const EMPTY: Suggestion = { products: [], categories: [] };
const POPULAR = ["cimento", "porcelanato", "tinta 18l", "cabo 2,5mm", "vaso sanitário", "telha"];

/**
 * Busca do header: sugestões em tempo real (produtos + categorias) com
 * navegação por teclado. A busca é o CTA principal de um e-commerce de
 * material de construção, então ela é grande e fica no centro.
 */
export function SearchBar({ className, initialQuery = "", autoFocus = false }: { className?: string; initialQuery?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [data, setData] = useState<Suggestion>(EMPTY);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (term: string) => {
    abortRef.current?.abort();
    if (term.trim().length < 2) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error("search failed");
      const json = (await res.json()) as Suggestion;
      setData(json);
      setActive(-1);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setData(EMPTY);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchSuggestions(q), 180);
    return () => window.clearTimeout(t);
  }, [q, fetchSuggestions]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const items: { key: string; href: string; label: string; kind: "category" | "product"; image?: string; price?: number; brand?: string }[] = [
    ...data.categories.map((c) => ({ key: `c-${c.slug}`, href: `/categoria/${c.slug}`, label: c.name, kind: "category" as const })),
    ...data.products.map((p) => ({ key: `p-${p.id}`, href: `/produto/${p.slug}`, label: p.name, kind: "product" as const, image: p.image, price: p.retailPrice, brand: p.brand })),
  ];
  const showPopular = open && q.trim().length < 2;
  const showList = open && items.length > 0;

  const submit = (term: string) => {
    const t = term.trim();
    if (!t) return;
    setOpen(false);
    router.push(`/busca?q=${encodeURIComponent(t)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (active >= 0 && items[active]) {
        e.preventDefault();
        setOpen(false);
        router.push(items[active].href);
      } else {
        e.preventDefault();
        submit(q);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
        className="relative flex h-12 items-center rounded-full border-2 border-brand-navy/15 bg-card pl-4 pr-1 transition-[border-color,box-shadow] duration-150 focus-within:border-brand-yellow focus-within:shadow-[0_0_0_4px_rgb(255_194_14/0.25)]"
      >
        <Search className="size-5 shrink-0 text-brand-ink-soft" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Busque por cimento, porcelanato, tinta, cabo..."
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-[0.95rem] text-brand-ink outline-none placeholder:text-brand-ink-soft/80 [&::-webkit-search-cancel-button]:hidden"
          aria-label="Buscar produtos"
        />
        {q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="mr-1 inline-flex size-8 items-center justify-center rounded-full text-brand-ink-soft hover:bg-muted"
            aria-label="Limpar busca"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <button
          type="submit"
          className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-brand-yellow px-4 font-heading text-sm font-bold text-brand-navy hover:bg-brand-yellow-2"
        >
          <Search className="size-4 sm:hidden" aria-hidden="true" />
          <span className="hidden sm:inline">Buscar</span>
        </button>
      </form>

      {showPopular || showList ? (
        <div
          className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-brand-line bg-popover shadow-[var(--shadow-float)] animate-in fade-in-0 zoom-in-[0.98] duration-150 origin-top"
        >
          {showPopular ? (
            <div className="p-3">
              <p className="px-2 pb-2 text-[0.7rem] font-bold uppercase tracking-wider text-brand-ink-soft">Mais buscados</p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {POPULAR.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => submit(term)}
                    className="press rounded-full border border-brand-line bg-card px-3 py-1.5 text-sm text-brand-ink hover:border-brand-yellow hover:bg-brand-yellow-soft"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showList ? (
            <ul id={`${id}-listbox`} role="listbox" aria-label="Sugestões" className="max-h-[70vh] overflow-y-auto py-2">
              {items.map((it, i) => (
                <li
                  key={it.key}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={active === i}
                  onMouseEnter={() => setActive(i)}
                >
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-center gap-3 px-4 py-2 text-sm transition-colors", active === i ? "bg-brand-yellow-soft" : "hover:bg-muted")}
                    tabIndex={-1}
                  >
                    {it.kind === "category" ? (
                      <>
                        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-navy/5 text-brand-navy dark:bg-muted dark:text-foreground">
                          <Grid2x2 className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-brand-ink">{it.label}</span>
                          <span className="block text-xs text-brand-ink-soft">Departamento</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {it.image ? <Image src={it.image} alt="" fill sizes="40px" className="object-cover" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-1 font-medium text-brand-ink">{it.label}</span>
                          <span className="block text-xs text-brand-ink-soft">{it.brand}</span>
                        </span>
                        <span className="shrink-0 font-heading text-sm font-bold text-brand-navy dark:text-foreground">{formatBRL(it.price ?? 0)}</span>
                      </>
                    )}
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t border-brand-line px-4 pt-2">
                <button type="button" onClick={() => submit(q)} className="w-full py-1.5 text-left text-sm font-semibold text-brand-navy hover:underline dark:text-foreground">
                  Ver todos os resultados para &ldquo;{q}&rdquo;
                </button>
              </li>
            </ul>
          ) : null}
          {loading && !showList ? <p className="sr-only" aria-live="polite">Buscando...</p> : null}
        </div>
      ) : null}
    </div>
  );
}
