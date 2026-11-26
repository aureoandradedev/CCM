"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertAdmin, assertRole } from "@/lib/admin/guard";
import type { UserRole } from "@/lib/supabase/auth";
import type { CampaignProduct } from "@/lib/admin/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils/format";
import { onlyDigits } from "@/lib/utils/masks";

export interface ActionResult {
  ok?: string;
  error?: string;
  id?: string;
}

/** Envolve a ação: exige admin, converte exceções em mensagem e revalida o admin. */
async function run(fn: (sb: Awaited<ReturnType<typeof createClient>>, adminId: string) => Promise<ActionResult | void>, paths: string[] = ["/admin"]): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const sb = await createClient();
    const r = (await fn(sb, admin.id)) ?? {};
    for (const p of paths) revalidatePath(p, "layout");
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

async function runOp(roles: UserRole[], fn: (sb: Awaited<ReturnType<typeof createClient>>, userId: string) => Promise<ActionResult | void>, paths: string[] = ["/admin"]): Promise<ActionResult> {
  try {
    const user = await assertRole(roles);
    const sb = await createClient();
    const r = (await fn(sb, user.id)) ?? {};
    for (const p of paths) revalidatePath(p, "layout");
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOrNull = (fd: FormData, k: string): number | null => {
  const v = str(fd, k).replace(/\./g, "").replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const list = (fd: FormData, k: string) =>
  str(fd, k)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function logEvent(sb: Awaited<ReturnType<typeof createClient>>, orderId: string, type: string, data: Record<string, unknown>, adminId: string) {
  await sb.from("order_events").insert({ order_id: orderId, type, data, actor_kind: "admin", actor_id: adminId });
}

/* ================================ PRODUTOS ================================ */

export async function saveProduct(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async (sb) => {
    const id = str(fd, "id") || `p-${Date.now().toString(36)}`;
    const name = str(fd, "name");
    if (name.length < 3) return { error: "Nome do produto muito curto." };
    const retail = numOrNull(fd, "retail_price");
    if (retail === null || retail < 0) return { error: "Preço de venda inválido." };
    const listPrice = numOrNull(fd, "list_price");
    if (listPrice !== null && listPrice <= retail) return { error: "O preço \"de\" precisa ser maior que o preço atual." };
    const category = str(fd, "category_slug");
    if (!category) return { error: "Escolha a categoria." };
    const brandName = str(fd, "brand_name") || "Sem marca";
    const brandSlug = slugify(brandName);
    await sb.from("brands").upsert({ slug: brandSlug, name: brandName }, { onConflict: "slug", ignoreDuplicates: true });

    let slug = str(fd, "slug") || slugify(name);
    const { data: clash } = await sb.from("products").select("id").eq("slug", slug).neq("id", id).maybeSingle();
    if (clash) slug = `${slug}-${id.slice(-4)}`;

    const specs = str(fd, "specs")
      .split("\n")
      .map((l) => l.split(/[:|]/))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([label, ...rest]) => ({ label: label.trim(), value: rest.join(":").trim() }));

    const row = {
      id,
      slug,
      sku: str(fd, "sku") || id.toUpperCase(),
      ean: str(fd, "ean") || null,
      name,
      brand_slug: brandSlug,
      brand_name: brandName,
      category_slug: category,
      subcategory_slug: str(fd, "subcategory_slug") || null,
      supplier_id: str(fd, "supplier_id") || null,
      unit: str(fd, "unit") || "un",
      pack_info: str(fd, "pack_info") || null,
      retail_price: retail,
      list_price: listPrice,
      pix_discount_pct: numOrNull(fd, "pix_discount_pct"),
      image_manual: bool(fd, "image_manual"),
      badges: list(fd, "badges"),
      short_description: str(fd, "short_description"),
      description: str(fd, "description") || null,
      specs,
      stock: intOrNull(fd, "stock"),
      max_per_order: intOrNull(fd, "max_per_order"),
      max_per_order_enabled: bool(fd, "max_per_order_enabled"),
      stock_status: (str(fd, "stock_status") || "supplier") as "in_stock" | "supplier" | "out",
      tags: list(fd, "tags"),
      yield_hint: str(fd, "yield_hint") || null,
      sort: intOrNull(fd, "sort") ?? 0,
      active: bool(fd, "active"),
    };
    const { error } = await sb.from("products").upsert(row, { onConflict: "id" });
    if (error) return { error: error.message };
    return { ok: "Produto salvo.", id };
  }, ["/admin/produtos"]);
  if (r.ok && str(fd, "redirect") === "list") redirect("/admin/produtos?ok=1");
  return r;
}

export async function setProductImages(id: string, images: string[], manual = true): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("products").update({ images, image_manual: manual, image_source: manual ? "admin" : null, image_pending: false, image_pending_reason: null }).eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Fotos atualizadas." };
  }, ["/admin/produtos"]);
}

export async function toggleProductActive(id: string, active: boolean): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("products").update({ active }).eq("id", id);
    if (error) return { error: error.message };
    return { ok: active ? "Produto ativado." : "Produto desativado." };
  }, ["/admin/produtos"]);
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { count } = await sb.from("order_items").select("id", { count: "exact", head: true }).eq("product_id", id);
    if (count) {
      await sb.from("products").update({ active: false }).eq("id", id);
      return { ok: "Produto tem pedidos: foi desativado em vez de excluído." };
    }
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Produto excluído." };
  }, ["/admin/produtos"]);
}

export async function duplicateProduct(id: string): Promise<ActionResult> {
  const r = await run(async (sb) => {
    const { data: p } = await sb.from("products").select("*").eq("id", id).maybeSingle();
    if (!p) return { error: "Produto não encontrado." };
    const novoId = `p-${Date.now().toString(36)}`;
    const { search: _s, created_at: _c, updated_at: _u, ...rest } = p as Record<string, unknown>;
    void _s;
    void _c;
    void _u;
    const { error } = await sb.from("products").insert({ ...rest, id: novoId, slug: `${p.slug}-copia-${novoId.slice(-4)}`, sku: `${p.sku}-C`, name: `${p.name} (cópia)`, active: false });
    if (error) return { error: error.message };
    return { ok: "Cópia criada (inativa).", id: novoId };
  }, ["/admin/produtos"]);
  if (r.id) redirect(`/admin/produtos/${r.id}`);
  return r;
}

/** Tira o produto de oferta: volta ao preço "de" e remove o selo. */
export async function removeOffer(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { data: p } = await sb.from("products").select("retail_price, list_price, badges").eq("id", id).maybeSingle();
    if (!p) return { error: "Produto não encontrado." };
    const badges = (p.badges as string[]).filter((b) => b !== "oferta");
    const { error } = await sb.from("products").update({ retail_price: p.list_price ?? p.retail_price, list_price: null, badges }).eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Oferta removida." };
  }, ["/admin/produtos", "/admin/ofertas"]);
}

/** Aplica ofertas em lote: [{id, price}] → list_price = preço atual (se não tinha), retail_price = price. */
export async function applyOffers(items: { id: string; price: number }[]): Promise<ActionResult> {
  return run(async (sb) => {
    let n = 0;
    for (const it of items) {
      const { data: p } = await sb.from("products").select("retail_price, list_price, badges").eq("id", it.id).maybeSingle();
      if (!p || !(it.price > 0)) continue;
      const base = Number(p.list_price ?? p.retail_price);
      if (it.price >= base) continue;
      const badges = Array.from(new Set([...(p.badges as string[]), "oferta"]));
      await sb.from("products").update({ list_price: base, retail_price: it.price, badges }).eq("id", it.id);
      n++;
    }
    return { ok: `${n} oferta(s) aplicada(s).` };
  }, ["/admin/produtos", "/admin/ofertas"]);
}

/* ================================= PEDIDOS ================================ */

const FLUXO: Record<string, string[]> = {
  "aguardando-confirmacao": ["aguardando-pagamento", "cancelado"],
  "aguardando-pagamento": ["em-separacao", "cancelado"],
  "em-separacao": ["separados", "aguardando-pagamento", "cancelado"],
  separados: ["pagos", "pagamento-pendente", "em-separacao"],
  "pagamento-pendente": ["pagos", "separados"],
  pagos: ["arquivados", "separados"],
  arquivados: [],
  cancelado: [],
};

export async function moveOrder(orderId: string, to: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { data: o } = await sb.from("orders").select("order_status, payment_status").eq("id", orderId).maybeSingle();
    if (!o) return { error: "Pedido não encontrado." };
    if (!FLUXO[o.order_status]?.includes(to)) return { error: `Não dá para ir de "${o.order_status}" para "${to}".` };
    if (to === "cancelado") {
      const { data: cancelData, error: cancelErr } = await sb.rpc("cancel_order_full", { p_order_id: orderId });
      if (cancelErr) return { error: cancelErr.message };
      if (cancelData?.error) return { error: cancelData.error as string };
      // CCM Etapa 5: release CCM stock reservations on cancel
      try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: orderId }); } catch {}
      await logEvent(sb, orderId, "status", { de: o.order_status, para: to }, adminId);
      return { ok: "Status atualizado." };
    }
    if (to === "separados") {
      const { data: ships } = await sb
        .from("order_shipments")
        .select("id, status, delivery_method")
        .eq("order_id", orderId);
      const deliveryShips = (ships ?? []).filter((s: { delivery_method: string }) => s.delivery_method === "delivery");
      const notReady = deliveryShips.filter((s: { status: string }) => s.status !== "pronto_para_envio");
      if (notReady.length > 0) {
        return { error: `Separação incompleta: ${notReady.length} entrega(s) ainda em "${notReady[0].status}". Conclua a separação antes de avançar.` };
      }
    }
    const patch: Record<string, unknown> = { order_status: to };
    if (to === "pagos" && o.payment_status !== "pago") patch.cash_pending = true;
    if (to === "arquivados") patch.archived_at = new Date().toISOString();
    const { error } = await sb.from("orders").update(patch).eq("id", orderId);
    if (error) return { error: error.message };
    await logEvent(sb, orderId, "status", { de: o.order_status, para: to }, adminId);
    return { ok: "Status atualizado." };
  }, ["/admin/pedidos"]);
}

/** Confirma recebimento (dinheiro/na entrega/faturado ou conciliação manual). */
export async function confirmPayment(orderId: string, metodo?: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { data: o } = await sb.from("orders").select("order_status, payment_status, payment_method").eq("id", orderId).maybeSingle();
    if (!o) return { error: "Pedido não encontrado." };
    if (o.payment_status === "pago") return { ok: "Já estava pago." };
    if (o.order_status === "aguardando-confirmacao") return { error: "Pedido ainda aguarda confirmação comercial. Use o fluxo de confirmação antes de registrar pagamento." };
    const patch: Record<string, unknown> = { payment_status: "pago", paid_at: new Date().toISOString(), cash_pending: false, cash_confirmed_at: new Date().toISOString(), payment_provider: "manual" };
    if (metodo) patch.payment_method = metodo;
    if (o.order_status === "aguardando-pagamento") patch.order_status = "em-separacao";
    if (o.order_status === "pagamento-pendente") patch.order_status = "pagos";
    const { error } = await sb.from("orders").update(patch).eq("id", orderId);
    if (error) return { error: error.message };
    await logEvent(sb, orderId, "pagamento-confirmado", { manual: true, metodo: metodo ?? o.payment_method }, adminId);
    return { ok: "Pagamento confirmado." };
  }, ["/admin/pedidos", "/admin/caixa"]);
}

export async function archiveOrder(orderId: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { error } = await sb.from("orders").update({ order_status: "arquivados", archived_at: new Date().toISOString() }).eq("id", orderId);
    if (error) return { error: error.message };
    await logEvent(sb, orderId, "arquivado", {}, adminId);
    return { ok: "Pedido arquivado." };
  }, ["/admin/pedidos"]);
}

export async function reopenOrder(orderId: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { data: o } = await sb.from("orders").select("payment_status, stock_reserved, order_status").eq("id", orderId).maybeSingle();
    if (!o) return { error: "Pedido não encontrado." };
    if (o.order_status === "cancelado" && !o.stock_reserved) {
      const { error: stockErr } = await sb.rpc("reserve_order_stock", { p_order_id: orderId });
      if (stockErr) {
        const m = stockErr.message?.match(/insufficient_stock:([^:]+)/);
        if (m) return { error: `Estoque insuficiente para "${m[1].trim()}". Não é possível reabrir.` };
        return { error: "Falha ao re-reservar estoque para este pedido." };
      }
    }
    const to = o.payment_status === "pago" ? "em-separacao" : "aguardando-confirmacao";
    const { error } = await sb.from("orders").update({ order_status: to, archived_at: null }).eq("id", orderId);
    if (error) return { error: error.message };
    await logEvent(sb, orderId, "reaberto", { para: to }, adminId);
    return { ok: "Pedido reaberto." };
  }, ["/admin/pedidos"]);
}

export async function cancelOrder(orderId: string, motivo: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { data, error } = await sb.rpc("cancel_order_full", { p_order_id: orderId });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error as string };
    // G4: Cancel pending supplier_requests (service_role required)
    try { await createAdminClient().rpc("cancel_order_requests", { p_order_id: orderId }); } catch {}
    // CCM Etapa 5: release CCM stock reservations on cancel
    try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: orderId }); } catch {}
    await logEvent(sb, orderId, "cancelado", { motivo, shipments_cancelled: data.shipments_cancelled, requirements_removed: data.requirements_removed }, adminId);
    return { ok: "Pedido cancelado." };
  }, ["/admin/pedidos"]);
}

/** Desconsiderar no faturamento (teste, duplicado, erro) com motivo. */
export async function excludeRevenue(orderId: string, motivo: string, excluir = true): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    if (excluir && motivo.trim().length < 3) return { error: "Informe o motivo." };
    const { error } = await sb
      .from("orders")
      .update({ revenue_excluded: excluir, revenue_excluded_reason: excluir ? motivo.trim() : null, revenue_excluded_at: excluir ? new Date().toISOString() : null })
      .eq("id", orderId);
    if (error) return { error: error.message };
    await logEvent(sb, orderId, excluir ? "desconsiderado" : "reconsiderado", { motivo }, adminId);
    return { ok: excluir ? "Pedido desconsiderado no faturamento." : "Pedido volta a contar no faturamento." };
  }, ["/admin/pedidos", "/admin/caixa", "/admin/bi"]);
}

export async function saveOrderNotes(orderId: string, notes: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("orders").update({ notes }).eq("id", orderId);
    if (error) return { error: error.message };
    return { ok: "Observação salva." };
  }, ["/admin/pedidos"]);
}

/** Limpeza: cancela aguardando-pagamento sem pagar há > 24 h, cancela aguardando-confirmacao expirados, e arquiva finalizados há > 24 h. */
export async function cleanupOrders(): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const limite24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // 1. aguardando-pagamento > 24h → cancela
    const { data: expirados } = await sb.from("orders").select("id").eq("order_status", "aguardando-pagamento").eq("payment_status", "pendente").lt("created_at", limite24h);
    for (const o of expirados ?? []) {
      const { data: cancelData, error: cancelErr } = await sb.rpc("cancel_order_full", { p_order_id: o.id });
      if (cancelErr || cancelData?.error) continue;
      try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: o.id }); } catch {}
      await logEvent(sb, o.id, "cancelado", { motivo: "expirado sem pagamento (limpeza)", shipments_cancelled: cancelData.shipments_cancelled, requirements_removed: cancelData.requirements_removed }, adminId);
    }

    // 2. aguardando-confirmacao > timeout configurável → cancela
    const { data: timeoutCfg } = await sb.from("ccm_configs").select("value").eq("key", "order_confirmation_timeout_hours").eq("scope", "global").limit(1).single();
    const timeoutHours = timeoutCfg?.value ? Number(timeoutCfg.value) : 48;
    const limiteConfirmacao = new Date(Date.now() - timeoutHours * 3600 * 1000).toISOString();
    const { data: confirmExpirados } = await sb.from("orders").select("id").eq("order_status", "aguardando-confirmacao").lt("created_at", limiteConfirmacao);
    for (const o of confirmExpirados ?? []) {
      const { data: cancelData, error: cancelErr } = await sb.rpc("cancel_order_full", { p_order_id: o.id });
      if (cancelErr || cancelData?.error) continue;
      try { await createAdminClient().rpc("release_ccm_stock", { p_order_id: o.id }); } catch {}
      await logEvent(sb, o.id, "cancelado", { motivo: `expirado sem confirmação em ${timeoutHours}h (limpeza)`, shipments_cancelled: cancelData.shipments_cancelled, requirements_removed: cancelData.requirements_removed }, adminId);
    }

    // 3. finalizados > 24h → arquiva
    const { data: pagos } = await sb.from("orders").select("id").eq("order_status", "pagos").lt("updated_at", limite24h);
    for (const o of pagos ?? []) {
      await sb.from("orders").update({ order_status: "arquivados", archived_at: new Date().toISOString() }).eq("id", o.id);
    }
    return { ok: `${expirados?.length ?? 0} pagamento(s) expirado(s), ${confirmExpirados?.length ?? 0} confirmação(ões) expirada(s), ${pagos?.length ?? 0} finalizado(s) arquivado(s).` };
  }, ["/admin/pedidos", "/compras"]);
}

/* ============================ CONTEÚDO / SETTINGS ========================= */

export async function saveSetting(key: string, value: unknown): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { error } = await sb.from("site_settings").upsert({ key, value, updated_by: adminId, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { error: error.message };
    return { ok: "Configuração salva." };
  }, ["/admin/conteudo", "/admin/configuracoes", "/admin/descontos"]);
}

export async function saveFreight(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const free = numOrNull(fd, "free_from") ?? 0;
  const flat = numOrNull(fd, "flat") ?? 0;
  const citiesRaw = str(fd, "delivery_cities");
  const allowedCities = citiesRaw
    ? citiesRaw.split("\n").map((c) => c.trim()).filter(Boolean)
    : [];
  const label = str(fd, "delivery_label") || "Sul do ES";
  const rejectMessage = str(fd, "delivery_reject") || "Não entregamos nessa região. Atendemos apenas as cidades disponíveis na nossa área de entrega.";
  return saveSetting("frete", {
    freeShippingFromCentavos: Math.round(free * 100),
    flatCentavos: Math.round(flat * 100),
    pickupEnabled: bool(fd, "pickup"),
    deliveryArea: { mode: "cities", allowedCities, label, rejectMessage },
  });
}

export async function saveBloqueio(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveSetting("entrega_bloqueio", { ativo: bool(fd, "ativo"), data: str(fd, "data") || null, mensagem: str(fd, "mensagem") });
}

export async function saveAviso(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveSetting("avisos", { topo: str(fd, "topo") });
}

export async function saveBestSellers(ids: string[]): Promise<ActionResult> {
  return saveSetting("best_sellers", { ids });
}

export async function saveDescontos(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const secoes: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("secao:")) {
      const n = Number(String(v).replace(",", "."));
      if (Number.isFinite(n) && n > 0) secoes[k.slice(6)] = n;
    }
  }
  return saveSetting("descontos", {
    pixPct: numOrNull(fd, "pixPct") ?? 5,
    primeiraCompra: { ativo: bool(fd, "primeira_ativo"), percentual: numOrNull(fd, "primeira_pct") ?? 0 },
    secoes,
  });
}

/* ================================= BANNERS ================================ */

export async function saveBanner(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async (sb) => {
    const id = str(fd, "id") || `b-${Date.now().toString(36)}`;
    const title = str(fd, "title");
    const image = str(fd, "image");
    if (!title) return { error: "Título obrigatório." };
    if (!image) return { error: "Envie a imagem do banner." };
    const rawHref = str(fd, "href") || "/ofertas";
    if (rawHref.startsWith("/") && !rawHref.startsWith("//")) {
      /* caminho interno — ok */
    } else {
      try {
        const u = new URL(rawHref);
        if (u.protocol !== "https:") return { error: "Link do banner deve ser caminho interno (/…) ou https://." };
      } catch {
        return { error: "Link do banner deve ser caminho interno (/…) ou https://." };
      }
    }

    const row = {
      id,
      eyebrow: str(fd, "eyebrow") || null,
      title,
      subtitle: str(fd, "subtitle") || null,
      cta: str(fd, "cta") || "Ver ofertas",
      href: rawHref,
      image,
      theme: str(fd, "theme") || "navy",
      variant: str(fd, "variant") || "photo",
      sort: intOrNull(fd, "sort") ?? 0,
      active: bool(fd, "active"),
    };
    const { error } = await sb.from("banners").upsert(row, { onConflict: "id" });
    if (error) return { error: error.message };
    return { ok: "Banner salvo.", id };
  }, ["/admin/conteudo"]);
  return r;
}

export async function deleteBanner(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("banners").delete().eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Banner excluído." };
  }, ["/admin/conteudo"]);
}

/* ================================ CAMPANHAS =============================== */

export async function saveCampaign(input: { id?: string; title: string; starts_at: string; products: CampaignProduct[]; banners: { image: string; sort: number }[] }): Promise<ActionResult> {
  const r = await run(async (sb, adminId) => {
    if (input.title.trim().length < 3) return { error: "Dê um título à campanha." };
    if (!input.starts_at) return { error: "Informe data e hora de início." };
    const row = { title: input.title.trim(), starts_at: new Date(input.starts_at).toISOString(), products: input.products, banners: input.banners, created_by: adminId };
    if (input.id) {
      const { error } = await sb.from("campaigns").update(row).eq("id", input.id).eq("status", "agendada");
      if (error) return { error: error.message };
      return { ok: "Campanha salva.", id: input.id };
    }
    const { data, error } = await sb.from("campaigns").insert(row).select("id").single();
    if (error) return { error: error.message };
    return { ok: "Campanha criada.", id: data.id };
  }, ["/admin/campanhas"]);
  return r;
}

/** Ativa agora: aplica os preços promocionais e liga os banners da campanha. */
export async function activateCampaign(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { data: c } = await sb.from("campaigns").select("*").eq("id", id).maybeSingle();
    if (!c || c.status !== "agendada") return { error: "Só campanhas agendadas podem ser ativadas." };
    const products: CampaignProduct[] = [];
    for (const it of (c.products as CampaignProduct[]) ?? []) {
      const { data: p } = await sb.from("products").select("retail_price, list_price, badges").eq("id", it.product_id).maybeSingle();
      if (!p) continue;
      const original = Number(p.retail_price);
      const badges = Array.from(new Set([...(p.badges as string[]), "oferta"]));
      await sb.from("products").update({ list_price: p.list_price ?? original, retail_price: it.price, badges }).eq("id", it.product_id);
      products.push({ ...it, original_price: original, original_list_price: p.list_price === null ? null : Number(p.list_price) });
    }
    const banners = ((c.banners as { image: string; sort: number }[]) ?? []).map((b, i) => ({
      id: `camp-${id.slice(0, 8)}-${i}`,
      title: c.title,
      cta: "Ver ofertas",
      href: "/ofertas",
      image: b.image,
      theme: "navy",
      variant: "photo",
      sort: -100 + (b.sort ?? i),
      active: true,
      campaign_id: id,
    }));
    if (banners.length) await sb.from("banners").upsert(banners, { onConflict: "id" });
    const { error } = await sb.from("campaigns").update({ status: "ativa", activated_at: new Date().toISOString(), products }).eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Campanha ativada." };
  }, ["/admin/campanhas", "/admin/produtos", "/admin/conteudo"]);
}

/** Encerra: restaura preços originais e remove os banners da campanha. */
export async function endCampaign(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { data: c } = await sb.from("campaigns").select("*").eq("id", id).maybeSingle();
    if (!c || c.status !== "ativa") return { error: "Só campanhas ativas podem ser encerradas." };
    for (const it of (c.products as CampaignProduct[]) ?? []) {
      if (it.original_price === undefined || it.original_price === null) continue;
      const { data: p } = await sb.from("products").select("badges").eq("id", it.product_id).maybeSingle();
      const badges = ((p?.badges as string[]) ?? []).filter((b) => b !== "oferta" || it.original_list_price);
      await sb.from("products").update({ retail_price: it.original_price, list_price: it.original_list_price ?? null, badges }).eq("id", it.product_id);
    }
    await sb.from("banners").delete().eq("campaign_id", id);
    const { error } = await sb.from("campaigns").update({ status: "encerrada", ended_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Campanha encerrada e preços restaurados." };
  }, ["/admin/campanhas", "/admin/produtos", "/admin/conteudo"]);
}

export async function cancelCampaign(id: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("campaigns").update({ status: "cancelada" }).eq("id", id).eq("status", "agendada");
    if (error) return { error: error.message };
    return { ok: "Campanha cancelada." };
  }, ["/admin/campanhas"]);
}

/* ============================ FORNECEDORES / CATEGORIAS =================== */

export async function saveSupplier(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const name = str(fd, "name");
    if (name.length < 2) return { error: "Nome fantasia obrigatório." };
    const tradeName = str(fd, "trade_name");
    if (tradeName.length < 3) return { error: "Razão social obrigatória (mín. 3 caracteres)." };
    const id = str(fd, "id") || slugify(name);

    const row = {
      id,
      name,
      trade_name: tradeName,
      state: str(fd, "state") || null,
      lead_time_days: intOrNull(fd, "lead_time_days") ?? 3,
      city: str(fd, "city") || null,
      cnpj: onlyDigits(fd.get("cnpj")) || null,
      contact_name: str(fd, "contact_name") || null,
      contact_email: str(fd, "contact_email") || null,
      contact_phone: str(fd, "contact_phone") || null,
      active: bool(fd, "active"),
    };

    if (row.cnpj) {
      const { data: existing } = await sb
        .from("suppliers")
        .select("id, name")
        .eq("cnpj", row.cnpj)
        .neq("id", id)
        .maybeSingle();
      if (existing) {
        return {
          error: `Já existe um fornecedor cadastrado com este CNPJ (${existing.name}).`,
        };
      }
    }

    const { error } = await sb.from("suppliers").upsert(row, { onConflict: "id" });
    if (error) {
      if (error.message.includes("suppliers_cnpj_unique")) {
        return {
          error: "Já existe um fornecedor cadastrado com este CNPJ.",
        };
      }
      return { error: error.message };
    }
    return { ok: "Fornecedor salvo.", id };
  }, ["/admin/fornecedores", "/admin/produtos"]);
}

export async function saveCommercialTerms(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const supplierId = str(fd, "supplier_id");
    if (!supplierId) return { error: "Fornecedor não informado." };

    const toNum = (v: string) => parseFloat(v.replace(/\./g, "").replace(",", ".") || "0");
    const pedidoMinimoTipo = str(fd, "pedido_minimo_tipo");
    const pedidoMinimo = toNum(str(fd, "pedido_minimo"));
    const freteTipo = str(fd, "frete_tipo");
    const freteValor = toNum(str(fd, "frete_valor"));
    const freteGratisAcima = toNum(str(fd, "frete_gratis_acima"));
    const prazo = intOrNull(fd, "prazo_entrega_cd_dias") ?? 3;
    const diasStr = str(fd, "dias_pedido");
    const dias = diasStr ? diasStr.split(",").map(Number).filter((n) => n >= 0 && n <= 6) : [];

    const { data, error } = await sb.rpc("save_supplier_commercial_terms_admin", {
      p_supplier_id: supplierId,
      p_pedido_minimo_tipo: pedidoMinimoTipo || "valor",
      p_pedido_minimo: pedidoMinimo,
      p_frete_tipo: freteTipo || "fixo",
      p_frete_gratis_acima: freteTipo === "gratis_acima" ? freteGratisAcima : null,
      p_frete_valor: freteValor,
      p_dias_pedido: dias.length > 0 ? dias : [1, 2, 3, 4, 5],
      p_prazo_entrega_cd_dias: prazo,
    });

    if (error) return { error: error.message };
    const result = data as { ok: boolean; error?: string };
    if (!result?.ok) return { error: result?.error ?? "Erro desconhecido." };
    return { ok: "Condições comerciais salvas." };
  }, ["/admin/fornecedores"]);
}

export async function linkUserToSupplier(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email").toLowerCase();
  const supplierId = str(fd, "supplier_id");
  if (!email || !supplierId) return { error: "E-mail e fornecedor são obrigatórios." };

  return run(async (sb) => {
    const { data: supplier } = await sb.from("suppliers").select("id").eq("id", supplierId).single();
    if (!supplier) return { error: "Fornecedor não encontrado." };

    const { data: profile } = await sb
      .from("profiles")
      .select("id, supplier_id, full_name")
      .eq("email", email)
      .single();

    if (!profile) return { error: `Nenhuma conta encontrada com o e-mail ${email}.` };
    if (profile.supplier_id === supplierId) return { error: "Usuário já está vinculado a este fornecedor." };
    if (profile.supplier_id) return { error: "Usuário já está vinculado a outro fornecedor. Desvincule primeiro." };

    const { error } = await sb
      .from("profiles")
      .update({ supplier_id: supplierId })
      .eq("id", profile.id);

    if (error) return { error: error.message };
    return { ok: `${profile.full_name || email} vinculado(a) ao fornecedor.` };
  }, ["/admin/fornecedores"]);
}

export async function unlinkUserFromSupplier(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const profileId = str(fd, "profile_id");
  const supplierId = str(fd, "supplier_id");
  if (!profileId || !supplierId) return { error: "Dados inválidos." };

  return run(async (sb) => {
    const { error } = await sb
      .from("profiles")
      .update({ supplier_id: null })
      .eq("id", profileId)
      .eq("supplier_id", supplierId);

    if (error) return { error: error.message };
    return { ok: "Usuário desvinculado." };
  }, ["/admin/fornecedores"]);
}

export async function approveAccessRequest(requestId: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { data: result, error: rpcErr } = await sb.rpc("approve_supplier_access", {
      p_request_id: requestId,
    });
    if (rpcErr) return { error: `Erro ao aprovar: ${rpcErr.message}` };
    const res = result as { ok: boolean; error?: string };
    if (!res.ok) return { error: res.error ?? "Erro inesperado." };
    return { ok: "Solicitação aprovada e usuário vinculado." };
  }, ["/admin/fornecedores"]);
}

export async function rejectAccessRequest(requestId: string, note?: string): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const { data: req } = await sb
      .from("supplier_access_requests")
      .select("id, status")
      .eq("id", requestId)
      .single();
    if (!req) return { error: "Solicitação não encontrada." };
    if (req.status !== "pending") return { error: "Esta solicitação já foi processada." };

    const { error } = await sb
      .from("supplier_access_requests")
      .update({
        status: "rejected",
        note: note?.trim() || null,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) return { error: error.message };

    return { ok: "Solicitação recusada." };
  }, ["/admin/fornecedores"]);
}

export async function saveCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const name = str(fd, "name");
    if (name.length < 2) return { error: "Nome da categoria." };
    const slug = str(fd, "slug") || slugify(name);
    const row = {
      slug,
      name,
      icon: str(fd, "icon") || "Package",
      description: str(fd, "description"),
      image: str(fd, "image") || null,
      tone: str(fd, "tone") || null,
      sort: intOrNull(fd, "sort") ?? 0,
      active: bool(fd, "active"),
    };
    const { error } = await sb.from("categories").upsert(row, { onConflict: "slug" });
    if (error) return { error: error.message };
    // subcategorias: uma por linha ("Nome" ou "slug|Nome")
    const linhas = str(fd, "subcategories")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const subs = linhas.map((l, i) => {
      const [a, b] = l.split("|").map((s) => s.trim());
      const subName = b || a;
      const subSlug = b ? a : `${slug}-${slugify(subName)}`;
      return { slug: subSlug, category_slug: slug, name: subName, sort: i };
    });
    const { data: atuais } = await sb.from("subcategories").select("slug").eq("category_slug", slug);
    const manter = new Set(subs.map((s) => s.slug));
    const remover = (atuais ?? []).map((s) => s.slug).filter((s) => !manter.has(s));
    if (remover.length) {
      await sb.from("products").update({ subcategory_slug: null }).in("subcategory_slug", remover);
      await sb.from("subcategories").delete().in("slug", remover);
    }
    if (subs.length) {
      const { error: e2 } = await sb.from("subcategories").upsert(subs, { onConflict: "slug" });
      if (e2) return { error: e2.message };
    }
    return { ok: "Categoria salva.", id: slug };
  }, ["/admin/categorias", "/admin/produtos"]);
}

/* ================================== ADMINS ================================ */

/* ================================ CONFIGS CCM ============================== */

export async function saveCcmConfig(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const key = str(fd, "key");
    const scope = str(fd, "scope") || "global";
    const scopeRef = str(fd, "scope_ref") || null;
    const rawValue = str(fd, "value");
    if (!key || !rawValue) return { error: "Chave e valor são obrigatórios." };

    let value: unknown;
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }

    const { data, error } = await sb.rpc("save_ccm_config", {
      p_key: key,
      p_scope: scope,
      p_scope_ref: scopeRef,
      p_value: value,
    });
    if (error) return { error: error.message };
    const res = data as { ok?: boolean; error?: string };
    if (res.error) return { error: res.error };
    return { ok: "Configuração salva." };
  }, ["/admin/configuracoes", "/admin/compras"]);
}

/* ========================= PEDIDOS DE COMPRA (Fase 14) ==================== */

export async function generatePurchaseOrder(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const supplierId = str(fd, "supplier_id");
    const cycleDate = str(fd, "cycle_date");
    if (!supplierId || !cycleDate) return { error: "Fornecedor e data do ciclo são obrigatórios." };

    const { data, error } = await sb.rpc("generate_purchase_order", {
      p_supplier_id: supplierId,
      p_cycle_date: cycleDate,
    });
    if (error) return { error: error.message };
    const res = data as { ok?: boolean; error?: string; purchase_order_id?: string; total_centavos?: number; minimum_met?: boolean };
    if (res.error) return { error: res.error };

    const label = res.minimum_met
      ? `Pedido gerado: R$ ${((res.total_centavos ?? 0) / 100).toFixed(2)}`
      : `Pedido abaixo do mínimo: R$ ${((res.total_centavos ?? 0) / 100).toFixed(2)}`;

    return { ok: label, id: res.purchase_order_id };
  }, ["/admin/compras"]);
}

export async function decidePurchaseOrder(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runOp(["compras"], async (sb, userId) => {
    const poId = str(fd, "purchase_order_id");
    const decision = str(fd, "decision");
    if (!poId || !decision) return { error: "Dados inválidos." };

    const { data: po } = await sb.from("supplier_purchase_orders").select("supplier_id").eq("id", poId).maybeSingle();

    const cancelDecisions = ["wait_next_cycle", "move_supplier"];
    const isSend = decision === "send";
    const newStatus = cancelDecisions.includes(decision) ? "cancelled" : "sent";
    const now = new Date().toISOString();
    const { error } = await sb.from("supplier_purchase_orders").update({
      decision: isSend ? null : decision,
      decided_by: userId,
      decided_at: now,
      status: newStatus,
      sent_at: newStatus === "sent" ? now : undefined,
    }).eq("id", poId).in("status", ["draft", "ready", "minimum_not_met"]);

    if (error) return { error: error.message };

    if (po?.supplier_id) {
      if (newStatus === "sent") {
        await sb.from("supplier_performance_events").upsert({
          supplier_id: po.supplier_id, event_type: "po_sent",
          reference_type: "purchase_order", reference_id: poId,
        }, { onConflict: "supplier_id,event_type,reference_type,reference_id", ignoreDuplicates: true });
      } else {
        await sb.from("supplier_performance_events").upsert({
          supplier_id: po.supplier_id, event_type: "cut_from_cycle",
          reference_type: "purchase_order", reference_id: poId,
          data: { reason: decision },
        }, { onConflict: "supplier_id,event_type,reference_type,reference_id", ignoreDuplicates: true });
      }
    }

    return { ok: "Decisão registrada." };
  }, ["/admin/compras", "/compras"]);
}

export async function consolidateCyclePurchaseOrders(): Promise<ActionResult> {
  return run(async (sb) => {
    const spDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { data, error } = await sb.rpc("consolidate_cycle_purchase_orders", {
      p_cycle_date: spDate,
    });
    if (error) return { error: error.message };
    const res = data as { ok?: boolean; error?: string; generated?: number; skipped?: number };
    if (!res.ok) return { error: res.error ?? "Erro ao consolidar." };
    if (res.generated === 0) return {};
    return { ok: `${res.generated} pedido(s) de compra gerado(s) automaticamente.` };
  }, ["/admin/compras"]);
}

/* ============================== ESTOQUE CCM ============================== */

export async function adjustInventory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const masterProductId = str(fd, "master_product_id");
    const movementType = str(fd, "movement_type") as "purchase_leftover" | "sale_from_stock" | "adjustment" | "write_off";
    const quantity = intOrNull(fd, "quantity");
    const unitCost = intOrNull(fd, "unit_cost_centavos");

    if (!masterProductId) return { error: "Produto obrigatório." };
    if (!movementType) return { error: "Tipo de movimento obrigatório." };
    if (quantity === null || quantity === 0) return { error: "Quantidade obrigatória." };

    if (movementType === "purchase_leftover" && quantity > 0) {
      const { error } = await sb.rpc("record_leftover", {
        p_master_product_id: masterProductId,
        p_quantity: quantity,
        p_unit_cost_centavos: unitCost ?? 0,
        p_source_supplier_id: str(fd, "supplier_id") || null,
        p_source_purchase_order_id: str(fd, "purchase_order_id") || null,
      });
      if (error) return { error: error.message };
      return { ok: `Sobra registrada: +${quantity} un.` };
    }

    if (movementType === "sale_from_stock" && quantity > 0) {
      const { error } = await sb.rpc("consume_leftover", {
        p_master_product_id: masterProductId,
        p_quantity: quantity,
      });
      if (error) return { error: error.message };
      return { ok: `Consumo registrado: -${quantity} un.` };
    }

    const qtyChange = movementType === "write_off" ? -Math.abs(quantity) : quantity;
    const { data, error } = await sb.rpc("record_inventory_movement", {
      p_master_product_id: masterProductId,
      p_movement_type: movementType,
      p_quantity: qtyChange,
      p_unit_cost_centavos: unitCost,
      p_reason: str(fd, "reason") || null,
    });
    if (error) return { error: error.message };
    const res = data as { ok?: boolean; error?: string } | null;
    if (res?.error) return { error: res.error };

    return { ok: "Movimento registrado." };
  }, ["/admin/compras"]);
}

/* ========================= HOLIDAY CALENDARS ============================== */

export async function saveHoliday(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const scope = str(fd, "scope") as "national" | "state" | "municipal";
    const stateCode = str(fd, "state_code") || null;
    const cityName = str(fd, "city_name") || null;
    const holidayDate = str(fd, "holiday_date");
    const name = str(fd, "name");
    const recurring = str(fd, "recurring") === "true";

    if (!holidayDate || !name) return { error: "Data e nome são obrigatórios." };
    if (scope === "state" && !stateCode) return { error: "Estado é obrigatório para feriado estadual." };
    if (scope === "municipal" && (!stateCode || !cityName)) return { error: "Estado e cidade são obrigatórios para feriado municipal." };

    const id = str(fd, "id");
    if (id) {
      const { error } = await sb.from("holiday_calendars").update({
        scope, state_code: stateCode, city_name: cityName,
        holiday_date: holidayDate, name, recurring,
      }).eq("id", id);
      if (error) return { error: error.message };
      return { ok: "Feriado atualizado." };
    }

    const { error } = await sb.from("holiday_calendars").insert({
      scope, state_code: stateCode, city_name: cityName,
      holiday_date: holidayDate, name, recurring, created_by: adminId,
    });
    if (error) return { error: error.message };
    return { ok: "Feriado cadastrado." };
  }, ["/admin/configuracoes"]);
}

export async function deleteHoliday(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const id = str(fd, "id");
    if (!id) return { error: "ID obrigatório." };
    const { error } = await sb.from("holiday_calendars").delete().eq("id", id);
    if (error) return { error: error.message };
    return { ok: "Feriado removido." };
  }, ["/admin/configuracoes"]);
}

export async function saveSupplierBusinessHours(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const supplierId = str(fd, "supplier_id");
    const businessHoursRaw = str(fd, "business_hours");
    const leadTimeMinutes = Number(str(fd, "lead_time_minutes")) || 30;

    if (!supplierId) return { error: "Fornecedor obrigatório." };

    let businessHours: Record<string, { open: string; close: string }> | null = null;
    if (businessHoursRaw) {
      try {
        businessHours = JSON.parse(businessHoursRaw);
      } catch {
        return { error: "Horários inválidos." };
      }
    }

    const { error } = await sb.from("supplier_commercial_terms")
      .update({ business_hours: businessHours, lead_time_minutes: leadTimeMinutes })
      .eq("supplier_id", supplierId)
      .eq("active", true)
      .is("valid_to", null);
    if (error) return { error: error.message };
    return { ok: "Horários de funcionamento atualizados." };
  }, ["/admin/fornecedores"]);
}

export async function saveCdConfig(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const city = str(fd, "cd_city") || null;
    const state = str(fd, "cd_state") || null;
    const address = str(fd, "cd_address") || null;
    const hours = str(fd, "cd_hours") || null;

    const upsert = async (key: string, value: string | null) => {
      const jsonValue = value ? JSON.stringify(value) : "null";
      const { error } = await sb.from("ccm_configs")
        .update({ value: jsonValue, updated_by: adminId })
        .eq("key", key).eq("scope", "global");
      if (error) {
        await sb.from("ccm_configs").insert({
          key, scope: "global", value: jsonValue, updated_by: adminId,
        });
      }
    };

    await upsert("cd_city", city);
    await upsert("cd_state", state);
    await upsert("cd_address", address);
    await upsert("cd_hours", hours);
    return { ok: "Configuração do CD atualizada." };
  }, ["/admin/configuracoes"]);
}

/* ======================== AUTO-PROMOTE PER SUPPLIER ====================== */

export async function toggleAutoPromote(supplierId: string, enabled: boolean): Promise<ActionResult> {
  try {
    const admin = await assertAdmin();
    const sb = await createClient();
    const scope = `supplier:${supplierId}`;
    const { error } = await sb.from("ccm_configs")
      .update({ value: enabled, updated_by: admin.id })
      .eq("key", "auto_promote")
      .eq("scope", scope);
    if (error) {
      await sb.from("ccm_configs").insert({
        key: "auto_promote",
        scope,
        value: enabled,
        updated_by: admin.id,
      });
    }
    revalidatePath(`/admin/fornecedores/${supplierId}`, "layout");
    revalidatePath("/admin/configuracoes", "layout");
    return { ok: enabled ? "Promoção automática ativada." : "Promoção automática desativada." };
  } catch (e) {
    return { error: (e as Error).message || "Erro inesperado." };
  }
}

/* ============================== PROMOTIONS =============================== */

export async function saveSupplierPromotion(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const supplierId = str(fd, "supplier_id");
    const discountPct = Number(str(fd, "discount_pct")) || 0;
    const minMarginPct = Number(str(fd, "min_margin_pct")) || 10;
    const validFrom = str(fd, "valid_from") || null;
    const validTo = str(fd, "valid_to") || null;
    const active = str(fd, "active") === "true";
    const promoId = str(fd, "promo_id") || null;

    if (!supplierId) return { error: "Fornecedor obrigatório." };
    if (discountPct <= 0 || discountPct > 50) return { error: "Desconto deve ser entre 0,01% e 50%." };

    if (promoId) {
      const { error } = await sb.from("supplier_promotions").update({
        discount_pct: discountPct,
        min_margin_pct: minMarginPct,
        valid_from: validFrom,
        valid_to: validTo,
        active,
        updated_by: adminId,
      }).eq("id", promoId);
      if (error) return { error: error.message };
    } else {
      const { error } = await sb.from("supplier_promotions").insert({
        supplier_id: supplierId,
        discount_pct: discountPct,
        min_margin_pct: minMarginPct,
        valid_from: validFrom,
        valid_to: validTo,
        active,
        created_by: adminId,
        updated_by: adminId,
      });
      if (error) return { error: error.message };
    }
    return { ok: "Promoção salva." };
  }, ["/admin/fornecedores"]);
}

export async function deleteSupplierPromotion(promoId: string): Promise<ActionResult> {
  return run(async (sb) => {
    const { error } = await sb.from("supplier_promotions").delete().eq("id", promoId);
    if (error) return { error: error.message };
    return { ok: "Promoção removida." };
  }, ["/admin/fornecedores"]);
}

/* ================================== ADMINS ================================ */

export async function setAdminRole(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const email = str(fd, "email").toLowerCase();
    const revogar = str(fd, "acao") === "revogar";
    const { data: p } = await sb.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!p) return { error: "Nenhuma conta com este e-mail. A pessoa precisa se cadastrar primeiro." };
    if (revogar && p.id === adminId) return { error: "Você não pode revogar o seu próprio acesso." };
    const { error } = await sb.from("profiles").update({ role: revogar ? "customer" : "admin" }).eq("id", p.id);
    if (error) return { error: error.message };
    return { ok: revogar ? "Acesso revogado." : "Agora é administrador." };
  }, ["/admin/configuracoes"]);
}

/* ============================= RECEBIMENTO ============================== */

export async function resolveException(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const exceptionId = str(fd, "exceptionId");
    const status = str(fd, "status") as "resolved" | "accepted" | "investigating";
    const notes = str(fd, "notes");
    if (!exceptionId) return { error: "ID da exceção obrigatório." };
    const { error } = await sb
      .from("operational_exceptions")
      .update({
        resolution_status: status,
        resolution_notes: notes || null,
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", exceptionId);
    if (error) return { error: error.message };
    return { ok: "Exceção atualizada." };
  }, ["/admin/recebimento"]);
}

/* ============================= SHIPMENT LIFECYCLE ============================== */

export async function updateShipmentStatus(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const shipmentId = str(fd, "shipmentId");
    const newStatus = str(fd, "status");
    if (!shipmentId || !newStatus) return { error: "shipmentId e status obrigatórios." };

    const { data: ship } = await sb.from("order_shipments").select("status").eq("id", shipmentId).maybeSingle();
    if (!ship) return { error: "Shipment não encontrado." };

    const { data, error } = await sb.rpc("transition_shipment_status", {
      p_shipment_id: shipmentId, p_new_status: newStatus, p_expected: ship.status,
      p_actor_kind: "admin", p_actor_id: adminId,
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    return { ok: `Status → ${newStatus}` };
  }, ["/admin/pedidos"]);
}

export async function setShipmentTracking(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const shipmentId = str(fd, "shipmentId");
    const trackingCode = str(fd, "trackingCode");
    const carrier = str(fd, "carrier");
    if (!shipmentId) return { error: "shipmentId obrigatório." };

    const { data, error } = await sb.rpc("set_shipment_tracking", {
      p_shipment_id: shipmentId, p_tracking_code: trackingCode || null, p_carrier: carrier || null,
      p_actor_kind: "admin", p_actor_id: adminId,
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    return { ok: "Rastreio atualizado." };
  }, ["/admin/pedidos"]);
}

/* ============================= PERFORMANCE ============================== */

export async function confirmPurchaseOrder(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runOp(["compras"], async (sb) => {
    const poId = str(fd, "purchase_order_id");
    if (!poId) return { error: "ID do pedido obrigatório." };

    const { data: po } = await sb
      .from("supplier_purchase_orders")
      .select("id, supplier_id, sent_at, confirmed_at, status")
      .eq("id", poId)
      .maybeSingle();

    if (!po) return { error: "Pedido de compra não encontrado." };
    if (po.confirmed_at) return { error: "Pedido já confirmado." };
    if (po.status !== "sent") return { error: `Status '${po.status}' não permite confirmação.` };

    const now = new Date().toISOString();
    const { error } = await sb
      .from("supplier_purchase_orders")
      .update({ confirmed_at: now })
      .eq("id", poId);
    if (error) return { error: error.message };

    let confirmationHours: number | null = null;
    if (po.sent_at) {
      const sentMs = new Date(po.sent_at).getTime();
      const nowMs = new Date(now).getTime();
      confirmationHours = Math.round(((nowMs - sentMs) / 3600000) * 10) / 10;
    }

    if (po.supplier_id) {
      await sb.from("supplier_performance_events").upsert({
        supplier_id: po.supplier_id, event_type: "po_confirmed",
        reference_type: "purchase_order", reference_id: poId,
        metric_value: confirmationHours,
      }, { onConflict: "supplier_id,event_type,reference_type,reference_id", ignoreDuplicates: true });
    }

    return { ok: "Confirmação registrada." };
  }, ["/admin/compras", "/compras"]);
}

export async function fetchOperationalKpis(supplierId: string, period: "30d" | "90d" | "todos") {
  "use server";
  const { getSupplierOperationalEvents } = await import("@/lib/admin/supplier-bi-data");
  const { aggregateOperationalKpis } = await import("@/lib/supplier-performance");
  const { assertRole } = await import("@/lib/admin/guard");
  await assertRole(["compras"]);

  const events = await getSupplierOperationalEvents(supplierId, period);
  const mapped = events.map((e) => ({
    ...e,
    supplier_id: supplierId,
    event_type: e.event_type as import("@/lib/supplier-performance").PerformanceEventType,
  }));
  if (mapped.length === 0) return null;
  return aggregateOperationalKpis(mapped);
}

export async function logShipmentOccurrence(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb, adminId) => {
    const shipmentId = str(fd, "shipmentId");
    const type = str(fd, "type");
    const description = str(fd, "description");
    if (!shipmentId || !type || !description) return { error: "Campos obrigatórios." };

    const { data, error } = await sb.rpc("log_shipment_occurrence", {
      p_shipment_id: shipmentId, p_type: type, p_description: description,
      p_actor_kind: "admin", p_actor_id: adminId,
    });
    if (error) return { error: error.message };
    if (data?.error) return { error: data.error };
    return { ok: "Ocorrência registrada." };
  }, ["/admin/pedidos"]);
}

/* ================================ FISCAL ================================ */

export async function syncFiscalDoc(docId: string): Promise<ActionResult> {
  return run(async (sb) => {
    if (!docId) return { error: "ID do documento fiscal ausente." };
    const { data: doc, error } = await sb.from("fiscal_documents").select("id, status, provider_reference").eq("id", docId).single();
    if (error || !doc) return { error: "Documento fiscal não encontrado." };
    if (doc.status === "invoiced" || doc.status === "cancelled") return { ok: "Documento já em estado final." };
    if (!doc.provider_reference) return { error: "Sem referência do provedor para sincronizar." };
    return { ok: "Sincronização fiscal solicitada." };
  }, ["/admin/pedidos"]);
}

export async function retryFiscalDoc(docId: string): Promise<ActionResult> {
  return run(async (sb) => {
    if (!docId) return { error: "ID do documento fiscal ausente." };
    const { data: doc, error } = await sb.from("fiscal_documents").select("id, status").eq("id", docId).single();
    if (error || !doc) return { error: "Documento fiscal não encontrado." };
    if (doc.status !== "error" && doc.status !== "pending") return { error: "Reenvio só é possível para documentos em erro ou pendentes." };
    const { error: upErr } = await sb.from("fiscal_documents").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("id", docId);
    if (upErr) return { error: upErr.message };
    return { ok: "Documento marcado para reenvio." };
  }, ["/admin/pedidos"]);
}

export async function assignShipmentDriver(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async (sb) => {
    const shipmentId = String(fd.get("shipmentId") ?? "").trim();
    const driverId = String(fd.get("driverId") ?? "").trim();
    if (!shipmentId) return { error: "ID da entrega é obrigatório." };
    if (!driverId) return { error: "Selecione um entregador." };
    const { error } = await sb.rpc("assign_shipment_driver", {
      p_shipment_id: shipmentId,
      p_driver_id: driverId,
    });
    if (error) return { error: error.message };
    return { ok: "Entregador atribuído." };
  }, ["/admin/pedidos"]);
}

export async function listActiveDrivers() {
  await assertAdmin();
  const sb = await createClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "entregador")
    .eq("is_active", true)
    .order("full_name");
  if (error) return [];
  return data ?? [];
}
