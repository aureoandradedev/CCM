import Image from "next/image";
import Link from "next/link";
import { Package, Plus, Search } from "lucide-react";

import { ImageBatch } from "@/components/admin/image-batch";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { Chip, Empty, NotConfigured, PageTitle, Pagination, Table, Td, Th, inputCls } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { adminCategories, adminListProducts, adminSuppliers, configured } from "@/lib/admin/data";
import { formatBRL } from "@/lib/utils/format";

type SP = Record<string, string | undefined>;

function href(sp: SP, patch: SP) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  u.delete("page");
  const s = u.toString();
  return `/admin/produtos${s ? `?${s}` : ""}`;
}

export default async function AdminProducts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (!configured()) return <NotConfigured />;
  const page = Number(sp.page ?? 1) || 1;
  const [{ items, total }, categories, suppliers] = await Promise.all([
    adminListProducts({ q: sp.q, category: sp.cat, supplier: sp.forn, foto: sp.foto as "sem" | "pendente" | undefined, status: (sp.status as "ativos" | "inativos" | "todos") ?? "ativos", oferta: sp.oferta === "1", atacado: sp.atacado === "1", page }),
    adminCategories(),
    adminSuppliers(),
  ]);

  return (
    <>
      <PageTitle title="Produtos" subtitle={`${total} produto(s)`}>
        <ImageBatch />
        <Button variant="brand" render={<Link href="/admin/produtos/novo" />}>
          <Plus /> Novo produto
        </Button>
      </PageTitle>

      <form className="mb-3 flex gap-2" action="/admin/produtos">
        {Object.entries(sp)
          .filter(([k, v]) => k !== "q" && k !== "page" && v)
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand-ink-soft" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por nome, SKU, marca ou EAN" className={`${inputCls} pl-9`} />
        </div>
        <Button type="submit" variant="navy">
          Buscar
        </Button>
      </form>

      <div className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
        <Chip href={href(sp, { status: undefined })} active={!sp.status || sp.status === "ativos"}>Ativos</Chip>
        <Chip href={href(sp, { status: "inativos" })} active={sp.status === "inativos"}>Inativos</Chip>
        <Chip href={href(sp, { status: "todos" })} active={sp.status === "todos"}>Todos</Chip>
        <span className="mx-1 w-px bg-brand-line" />
        <Chip href={href(sp, { foto: sp.foto === "sem" ? undefined : "sem" })} active={sp.foto === "sem"}>Sem foto real</Chip>
        <Chip href={href(sp, { foto: sp.foto === "pendente" ? undefined : "pendente" })} active={sp.foto === "pendente"}>Foto pendente</Chip>
        <Chip href={href(sp, { oferta: sp.oferta === "1" ? undefined : "1" })} active={sp.oferta === "1"}>Em oferta</Chip>
        <Chip href={href(sp, { atacado: sp.atacado === "1" ? undefined : "1" })} active={sp.atacado === "1"}>Com atacado</Chip>
        <span className="mx-1 w-px bg-brand-line" />
        {categories.map((c) => (
          <Chip key={c.slug} href={href(sp, { cat: sp.cat === c.slug ? undefined : c.slug })} active={sp.cat === c.slug}>
            {c.name}
          </Chip>
        ))}
        {suppliers.length > 1 ? (
          <>
            <span className="mx-1 w-px bg-brand-line" />
            {suppliers.map((s) => (
              <Chip key={s.id} href={href(sp, { forn: sp.forn === s.id ? undefined : s.id })} active={sp.forn === s.id}>
                {s.name}
              </Chip>
            ))}
          </>
        ) : null}
      </div>

      {items.length ? (
        <Table>
          <thead>
            <tr>
              <Th className="w-14"></Th>
              <Th>Produto</Th>
              <Th>Categoria</Th>
              <Th className="text-right">Varejo</Th>
              <Th className="text-right">Atacado</Th>
              <Th>Estoque</Th>
              <Th className="w-44"></Th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const img = p.images?.[0];
              const placeholder = !img || /unsplash\.com/.test(img);
              return (
                <tr key={p.id} className={p.active ? "hover:bg-muted/50" : "opacity-60 hover:bg-muted/50"}>
                  <Td>
                    <span className="relative block size-11 overflow-hidden rounded-lg border border-brand-line bg-white">
                      {img ? <Image src={img} alt="" fill sizes="44px" className="object-contain p-0.5" /> : <Package className="m-auto mt-2.5 size-6 text-brand-ink-soft" />}
                      {placeholder ? <span className="absolute inset-x-0 bottom-0 bg-brand-orange text-center text-[0.55rem] font-bold text-white">sem foto</span> : null}
                    </span>
                  </Td>
                  <Td>
                    <Link href={`/admin/produtos/${p.id}`} className="line-clamp-2 font-semibold text-brand-ink hover:text-brand-navy hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-brand-ink-soft">
                      {p.brand_name} · {p.sku}
                      {p.list_price ? <span className="ml-1 rounded bg-brand-red/10 px-1 font-bold text-brand-red">OFERTA</span> : null}
                      {!p.active ? <span className="ml-1 rounded bg-muted px-1 font-bold">INATIVO</span> : null}
                    </p>
                  </Td>
                  <Td className="text-xs text-brand-ink-soft">{categories.find((c) => c.slug === p.category_slug)?.name ?? p.category_slug}</Td>
                  <Td className="text-right tabular-nums">
                    <span className="font-bold text-brand-navy">{formatBRL(Number(p.retail_price))}</span>
                    {p.list_price ? <p className="text-xs text-brand-ink-soft line-through">{formatBRL(Number(p.list_price))}</p> : null}
                    <p className="text-[0.65rem] text-brand-ink-soft">/{p.unit}</p>
                  </Td>
                  <Td className="text-right text-xs tabular-nums">{p.wholesale_price ? <>{formatBRL(Number(p.wholesale_price))}<p className="text-brand-ink-soft">≥ {p.wholesale_min_qty}</p></> : "—"}</Td>
                  <Td className="text-xs">
                    {p.stock === null ? <span className="text-brand-ink-soft">sem controle</span> : p.stock === 0 ? <span className="font-bold text-brand-red">esgotado</span> : p.stock <= 5 ? <span className="font-bold text-brand-orange">{p.stock} (últimas)</span> : p.stock}
                    {p.max_per_order_enabled && p.max_per_order ? <p className="text-brand-ink-soft">máx. {p.max_per_order}/pedido</p> : null}
                  </Td>
                  <Td>
                    <ProductRowActions product={p} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <Empty>Nenhum produto com esses filtros.</Empty>
      )}
      <Pagination page={page} total={total} perPage={40} href={(p) => `${href(sp, {})}${href(sp, {}).includes("?") ? "&" : "?"}page=${p}`} />
    </>
  );
}
