import { createClient } from "@/lib/supabase/server";
import { rankAllProducts, rankProductOffers } from "@/lib/ranking/engine";
import type { RankableOffer } from "@/lib/ranking/types";
import { resolveMargin, calculatePrice, type MarginRule } from "./pricing";

const PER_PAGE = 25;

function toRankable(o: Record<string, unknown>): RankableOffer {
  return {
    id: o.id as string,
    master_product_id: o.master_product_id as string,
    supplier_id: o.supplier_id as string,
    cost_centavos: o.cost_centavos as number,
    stock: o.stock as number | null,
    lead_time_days: o.lead_time_days as number,
    status: o.status as string,
  };
}

export async function comprasDashboard() {
  const sb = await createClient();

  const [
    { count: totalCatalogs },
    { count: pendingCatalogs },
    { count: pendente },
    { count: normalizado },
    { count: matchSugerido },
    { count: revisaoManual },
    { count: aprovado },
    { count: rejeitado },
    { data: rawOffers },
    { count: totalSelections },
  ] = await Promise.all([
    sb.from("supplier_catalogs").select("*", { count: "exact", head: true }),
    sb.from("supplier_catalogs").select("*", { count: "exact", head: true }).neq("status", "concluido"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "pendente"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "normalizado"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "match_sugerido"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "revisao_manual"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "aprovado"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "rejeitado"),
    sb.from("supplier_offers")
      .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status")
      .eq("status", "ativa")
      .is("replaced_at", null),
    sb.from("sourcing_selections").select("*", { count: "exact", head: true }).is("replaced_at", null),
  ]);

  const rankings = rankAllProducts((rawOffers ?? []).map(toRankable));

  return {
    catalogs: { total: totalCatalogs ?? 0, pending: pendingCatalogs ?? 0 },
    items: {
      pendente: pendente ?? 0,
      normalizado: normalizado ?? 0,
      match_sugerido: matchSugerido ?? 0,
      revisao_manual: revisaoManual ?? 0,
      aprovado: aprovado ?? 0,
      rejeitado: rejeitado ?? 0,
    },
    offers: {
      total: rankings.length,
      multiOffer: rankings.filter((r) => r.offers.length > 1).length,
      ambiguous: rankings.filter((r) => r.ambiguous).length,
      clear: rankings.filter((r) => r.recommended_offer_id != null).length,
      selected: totalSelections ?? 0,
    },
  };
}

export async function catalogList(page = 1) {
  const sb = await createClient();
  const from = (page - 1) * PER_PAGE;

  const { data, count } = await sb
    .from("supplier_catalogs")
    .select(
      "id, supplier_id, source, source_name, status, total_items, processed, errors, warnings, created_at, suppliers(name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + PER_PAGE - 1);

  return {
    catalogs: (data ?? []).map((c) => ({
      id: c.id as string,
      supplier_id: c.supplier_id as string,
      supplier_name: ((c as Record<string, unknown>).suppliers as { name: string } | null)?.name ?? "—",
      source: c.source as string,
      source_name: c.source_name as string | null,
      status: c.status as string,
      total_items: c.total_items as number,
      processed: c.processed as number,
      errors: c.errors as number,
      warnings: c.warnings as number,
      created_at: c.created_at as string,
    })),
    total: count ?? 0,
  };
}

export async function catalogDetail(catalogId: string, matchStatus: string | null, page = 1) {
  const sb = await createClient();
  const from = (page - 1) * PER_PAGE;

  const catalogQ = sb
    .from("supplier_catalogs")
    .select("id, supplier_id, source, source_name, status, total_items, processed, errors, warnings, notes, created_at, suppliers(name)")
    .eq("id", catalogId)
    .single();

  let itemsQ = sb
    .from("supplier_catalog_items")
    .select(
      "id, name, supplier_sku, ean, brand, model, category_original, match_status, match_confidence, match_signals, master_product_id, master_products(name, ean)",
      { count: "exact" },
    )
    .eq("catalog_id", catalogId)
    .order("name");
  if (matchStatus) itemsQ = itemsQ.eq("match_status", matchStatus);
  itemsQ = itemsQ.range(from, from + PER_PAGE - 1);

  const [catalogRes, itemsRes] = await Promise.all([catalogQ, itemsQ]);

  const c = catalogRes.data as Record<string, unknown> | null;
  const catalog = c
    ? {
        id: c.id as string,
        supplier_id: c.supplier_id as string,
        supplier_name: (c.suppliers as { name: string } | null)?.name ?? "—",
        source: c.source as string,
        source_name: c.source_name as string | null,
        status: c.status as string,
        total_items: c.total_items as number,
        processed: c.processed as number,
        errors: c.errors as number,
        warnings: c.warnings as number,
        notes: c.notes as string | null,
        created_at: c.created_at as string,
      }
    : null;

  return {
    catalog,
    items: (itemsRes.data ?? []).map((r) => {
      const i = r as Record<string, unknown>;
      return {
        id: i.id as string,
        name: i.name as string,
        supplier_sku: i.supplier_sku as string | null,
        ean: i.ean as string | null,
        brand: i.brand as string | null,
        model: i.model as string | null,
        category_original: i.category_original as string | null,
        match_status: i.match_status as string,
        match_confidence: i.match_confidence as number | null,
        match_signals: i.match_signals,
        master_product_id: i.master_product_id as string | null,
        master_product_name: (i.master_products as { name: string } | null)?.name ?? null,
        master_product_ean: (i.master_products as { ean: string } | null)?.ean ?? null,
      };
    }),
    total: itemsRes.count ?? 0,
  };
}

export async function matchingQueue(page = 1) {
  const sb = await createClient();
  const from = (page - 1) * PER_PAGE;

  const { data, count } = await sb
    .from("supplier_catalog_items")
    .select(
      "id, catalog_id, name, supplier_sku, ean, brand, model, match_status, match_confidence, match_signals, master_product_id, supplier_id, suppliers(name), master_products(id, name, ean)",
      { count: "exact" },
    )
    .in("match_status", ["match_sugerido", "revisao_manual"])
    .order("match_confidence", { ascending: false, nullsFirst: false })
    .range(from, from + PER_PAGE - 1);

  return {
    items: (data ?? []).map((r) => {
      const i = r as Record<string, unknown>;
      return {
        id: i.id as string,
        catalog_id: i.catalog_id as string,
        name: i.name as string,
        supplier_sku: i.supplier_sku as string | null,
        ean: i.ean as string | null,
        brand: i.brand as string | null,
        model: i.model as string | null,
        match_status: i.match_status as string,
        match_confidence: i.match_confidence as number | null,
        match_signals: i.match_signals,
        master_product_id: i.master_product_id as string | null,
        supplier_id: i.supplier_id as string,
        supplier_name: (i.suppliers as { name: string } | null)?.name ?? "—",
        master_product_name: (i.master_products as { name: string } | null)?.name ?? null,
        master_product_ean: (i.master_products as { ean: string } | null)?.ean ?? null,
      };
    }),
    total: count ?? 0,
  };
}

export async function matchingQueueByStatus(status: string, page = 1) {
  const sb = await createClient();
  const from = (page - 1) * PER_PAGE;

  let q = sb
    .from("supplier_catalog_items")
    .select(
      "id, catalog_id, name, supplier_sku, ean, brand, model, category_original, match_status, match_confidence, match_signals, master_product_id, supplier_id, normalized_data, suppliers(name), master_products(id, name, ean)",
      { count: "exact" },
    );

  if (status === "sem_master") {
    q = q.eq("match_status", "normalizado").is("master_product_id", null);
  } else if (status === "revisao") {
    q = q.in("match_status", ["match_sugerido", "revisao_manual"]);
  } else {
    q = q.eq("match_status", status);
  }

  q = q.order("match_confidence", { ascending: false, nullsFirst: false }).range(from, from + PER_PAGE - 1);

  const { data, count } = await q;

  return {
    items: (data ?? []).map((r) => {
      const i = r as Record<string, unknown>;
      return {
        id: i.id as string,
        catalog_id: i.catalog_id as string,
        name: i.name as string,
        supplier_sku: i.supplier_sku as string | null,
        ean: i.ean as string | null,
        brand: i.brand as string | null,
        model: i.model as string | null,
        category_original: i.category_original as string | null,
        match_status: i.match_status as string,
        match_confidence: i.match_confidence as number | null,
        match_signals: i.match_signals,
        master_product_id: i.master_product_id as string | null,
        supplier_id: i.supplier_id as string,
        supplier_name: (i.suppliers as { name: string } | null)?.name ?? "—",
        master_product_name: (i.master_products as { name: string } | null)?.name ?? null,
        master_product_ean: (i.master_products as { ean: string } | null)?.ean ?? null,
        normalized_data: i.normalized_data as Record<string, unknown> | null,
      };
    }),
    total: count ?? 0,
  };
}

export async function matchingStatusCounts() {
  const sb = await createClient();

  const [
    { count: revisao },
    { count: semMaster },
    { count: aprovado },
    { count: rejeitado },
  ] = await Promise.all([
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).in("match_status", ["match_sugerido", "revisao_manual"]),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "normalizado").is("master_product_id", null),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "aprovado"),
    sb.from("supplier_catalog_items").select("*", { count: "exact", head: true }).eq("match_status", "rejeitado"),
  ]);

  return {
    revisao: revisao ?? 0,
    sem_master: semMaster ?? 0,
    aprovado: aprovado ?? 0,
    rejeitado: rejeitado ?? 0,
  };
}

export async function offerProducts(page = 1) {
  const sb = await createClient();

  const [{ data: rawOffers }, { data: selections }] = await Promise.all([
    sb.from("supplier_offers")
      .select("id, master_product_id, supplier_id, cost_centavos, stock, lead_time_days, status")
      .eq("status", "ativa")
      .is("replaced_at", null),
    sb.from("sourcing_selections")
      .select("master_product_id, supplier_offer_id")
      .is("replaced_at", null),
  ]);

  if (!rawOffers || rawOffers.length === 0) return { products: [], total: 0 };

  const offers = rawOffers.map(toRankable);
  const selMap = new Map(
    (selections ?? []).map((s) => [s.master_product_id as string, s.supplier_offer_id as string]),
  );

  const grouped = new Map<string, RankableOffer[]>();
  for (const o of offers) {
    const g = grouped.get(o.master_product_id);
    if (g) g.push(o);
    else grouped.set(o.master_product_id, [o]);
  }

  const rankings = rankAllProducts(offers);
  const allIds = [...grouped.keys()];
  const totalProducts = allIds.length;
  const from = (page - 1) * PER_PAGE;
  const pageIds = allIds.slice(from, from + PER_PAGE);

  const { data: masterProducts } =
    pageIds.length > 0
      ? await sb.from("master_products").select("id, name, ean, brand_slug").in("id", pageIds)
      : { data: [] as { id: string; name: string; ean: string | null; brand_slug: string | null }[] };

  return {
    products: pageIds.map((mpId) => {
      const mp = masterProducts?.find((p) => p.id === mpId);
      const ranking = rankings.find((r) => r.master_product_id === mpId);
      const activeCount = grouped.get(mpId)?.length ?? 0;
      return {
        master_product_id: mpId,
        name: mp?.name ?? "—",
        ean: mp?.ean ?? null,
        brand_slug: mp?.brand_slug ?? null,
        active_offers: activeCount,
        selected_offer_id: selMap.get(mpId) ?? null,
        ranking,
      };
    }),
    total: totalProducts,
  };
}

export async function offerDetail(masterProductId: string) {
  const sb = await createClient();

  const [productRes, offersRes, selRes, historyRes] = await Promise.all([
    sb.from("master_products")
      .select("id, name, ean, brand_slug, brand_name, model, category_slug, unit, specs")
      .eq("id", masterProductId)
      .single(),
    sb.from("supplier_offers")
      .select(
        "id, master_product_id, supplier_id, catalog_item_id, cost_centavos, stock, lead_time_days, status, valid_until, attributes, created_at, updated_at, replaced_at, suppliers(name)",
      )
      .eq("master_product_id", masterProductId)
      .eq("status", "ativa")
      .is("replaced_at", null)
      .order("cost_centavos"),
    sb.from("sourcing_selections")
      .select("id, supplier_offer_id, selected_by, selected_at, note, score, ambiguous")
      .eq("master_product_id", masterProductId)
      .is("replaced_at", null)
      .maybeSingle(),
    sb.from("sourcing_selections")
      .select("id, supplier_offer_id, selected_by, selected_at, replaced_at, note, score, ambiguous")
      .eq("master_product_id", masterProductId)
      .order("selected_at", { ascending: false }),
  ]);

  const product = productRes.data;
  const rawOffers = offersRes.data ?? [];
  const ranking = rankProductOffers(rawOffers.map(toRankable));

  return {
    product,
    offers: rawOffers.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: o.id as string,
        supplier_id: o.supplier_id as string,
        supplier_name: (o.suppliers as { name: string } | null)?.name ?? "—",
        cost_centavos: o.cost_centavos as number,
        stock: o.stock as number | null,
        lead_time_days: o.lead_time_days as number,
        status: o.status as string,
        valid_until: o.valid_until as string | null,
        attributes: o.attributes as Record<string, unknown>,
        created_at: o.created_at as string,
        updated_at: o.updated_at as string,
      };
    }),
    ranking,
    currentSelection: selRes.data
      ? {
          id: selRes.data.id as string,
          supplier_offer_id: selRes.data.supplier_offer_id as string,
          selected_by: selRes.data.selected_by as string,
          selected_at: selRes.data.selected_at as string,
          note: selRes.data.note as string | null,
          score: selRes.data.score as number | null,
          ambiguous: selRes.data.ambiguous as boolean,
        }
      : null,
    selectionHistory: (historyRes.data ?? []).map((r) => ({
      id: r.id as string,
      supplier_offer_id: r.supplier_offer_id as string,
      selected_by: r.selected_by as string,
      selected_at: r.selected_at as string,
      replaced_at: r.replaced_at as string | null,
      note: r.note as string | null,
      score: r.score as number | null,
      ambiguous: r.ambiguous as boolean,
    })),
  };
}

export async function publishPreview(masterProductId: string) {
  const sb = await createClient();

  const [mpRes, selRes, rulesRes, existingRes] = await Promise.all([
    sb.from("master_products")
      .select("id, name, ean, brand_slug, brand_name, model, category_slug, subcategory_slug, unit, pack_info, description, specs, images, tags")
      .eq("id", masterProductId)
      .single(),
    sb.from("sourcing_selections")
      .select("id, supplier_offer_id, selected_at, score, ambiguous, note")
      .eq("master_product_id", masterProductId)
      .is("replaced_at", null)
      .maybeSingle(),
    sb.from("margin_rules")
      .select("id, scope, scope_ref, margin_pct, min_price_centavos, rounding, priority, active")
      .eq("active", true),
    sb.from("products")
      .select("id, master_product_id, sourcing_selection_id, retail_price, cost_centavos, margin_pct, publish_status, updated_at")
      .eq("master_product_id", masterProductId)
      .in("publish_status", ["publicada", "rascunho", "aguardando_aprovacao"])
      .maybeSingle(),
  ]);

  const mp = mpRes.data;
  if (!mp) return { error: "Produto mestre nao encontrado." } as const;

  const selection = selRes.data;
  if (!selection) return { mp, error: "Nenhuma selecao de sourcing ativa." } as const;

  const { data: offerData } = await sb
    .from("supplier_offers")
    .select("id, supplier_id, cost_centavos, stock, lead_time_days, status, replaced_at, suppliers(id, name, lead_time_days, city)")
    .eq("id", selection.supplier_offer_id as string)
    .single();

  if (!offerData) return { mp, selection, error: "Oferta selecionada nao encontrada." } as const;

  const offer = offerData as Record<string, unknown>;
  const offerStatus = offer.status as string;
  const offerReplacedAt = offer.replaced_at as string | null;
  const cost = offer.cost_centavos as number;
  const stock = offer.stock as number | null;

  const problems: string[] = [];
  if (offerReplacedAt != null) problems.push("Oferta foi substituída por nova versão. Selecione a versão atual antes de publicar.");
  if (offerStatus !== "ativa") problems.push(`Oferta com status '${offerStatus}' (esperado: ativa).`);
  if (cost <= 0) problems.push("Custo invalido (zero ou negativo).");
  if (stock != null && stock <= 0) problems.push("Estoque zerado.");
  if (!mp.name) problems.push("Produto mestre sem nome.");

  const rules = ((rulesRes.data ?? []) as unknown as MarginRule[]).map((r) => ({
    ...r,
    margin_pct: Number(r.margin_pct),
    min_price_centavos: r.min_price_centavos != null ? Number(r.min_price_centavos) : null,
    priority: Number(r.priority),
  }));

  const marginResult = resolveMargin(rules, masterProductId, mp.category_slug);
  if (!marginResult) {
    problems.push("Nenhuma regra de margem aplicavel.");
  } else if (!marginResult.ok) {
    problems.push(
      `Margem ambigua: ${marginResult.tied.length} regras empatadas em ${marginResult.source} (prioridade ${marginResult.tied[0].priority}). Ajuste as prioridades.`,
    );
  }

  const resolved = marginResult?.ok ? marginResult : null;
  const pricing = resolved && cost > 0 ? calculatePrice(cost, resolved) : null;

  const supplier = offer.suppliers as { id: string; name: string; lead_time_days: number; city: string | null } | null;

  const isRepublish = existingRes.data != null;
  const isStale = existingRes.data?.sourcing_selection_id !== selection.id;

  return {
    mp,
    selection: {
      id: selection.id as string,
      supplier_offer_id: selection.supplier_offer_id as string,
      selected_at: selection.selected_at as string,
      score: selection.score as number | null,
      ambiguous: selection.ambiguous as boolean,
      note: selection.note as string | null,
    },
    offer: {
      id: offer.id as string,
      supplier_id: offer.supplier_id as string,
      supplier_name: supplier?.name ?? "—",
      supplier_city: supplier?.city ?? null,
      cost_centavos: cost,
      stock,
      lead_time_days: offer.lead_time_days as number,
      status: offerStatus,
    },
    pricing,
    existingProduct: existingRes.data
      ? {
          id: existingRes.data.id as string,
          sourcing_selection_id: existingRes.data.sourcing_selection_id as string | null,
          retail_price: Number(existingRes.data.retail_price),
          cost_centavos: existingRes.data.cost_centavos as number | null,
          margin_pct: existingRes.data.margin_pct != null ? Number(existingRes.data.margin_pct) : null,
          publish_status: existingRes.data.publish_status as string,
          updated_at: existingRes.data.updated_at as string,
        }
      : null,
    isRepublish,
    isStale,
    problems,
  };
}
