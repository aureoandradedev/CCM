/**
 * Data layer for /admin/automacao — Central Operacional.
 *
 * Aggregates events from existing tables into a unified timeline:
 *   - supplier_replacement_log  (trocas de fornecedor)
 *   - price_change_log          (alterações de preço)
 *   - sourcing_selections       (seleções de sourcing)
 *   - procurement_exceptions    (exceções detectadas)
 *   - procurement_audit_log     (execuções do orquestrador)
 */
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

// ─── Unified event types ──────────────────────────────────────────────────

export type AutomacaoEventType =
  | "troca_fornecedor"
  | "alteracao_preco"
  | "selecao_sourcing"
  | "excecao_detectada"
  | "excecao_resolvida"
  | "execucao_orquestrador";

export type AutomacaoMode = "automatico" | "manual";

export interface AutomacaoEvent {
  id: string;
  type: AutomacaoEventType;
  mode: AutomacaoMode;
  timestamp: string;
  productName: string | null;
  productId: string | null;
  masterProductId: string | null;
  title: string;
  description: string;
  reason: string;
  reasonCode: string | null;
  status: "aplicado" | "bloqueado" | "pendente" | "resolvido" | "descartado";
  supplierOld: string | null;
  supplierNew: string | null;
  priceOld: number | null;
  priceNew: number | null;
  changePct: number | null;
  severity: string | null;
  detail: Record<string, unknown>;
}

export interface AutomacaoFilters {
  period?: "hoje" | "7d" | "30d" | "todos";
  type?: AutomacaoEventType;
  mode?: AutomacaoMode;
  status?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

export interface AutomacaoKpis {
  totalEventos7d: number;
  trocasAuto7d: number;
  precosAuto7d: number;
  excecoesAbertas: number;
  ultimaExecucao: string | null;
  ultimaExecucaoStatus: string | null;
}

export interface ProductHistory {
  masterProductId: string;
  productName: string;
  events: AutomacaoEvent[];
}

// ─── Reason code translations ─────────────────────────────────────────────

const REASON_TRANSLATIONS: Record<string, string> = {
  // Auto-sourcing reasons
  best_score: "Fornecedor com melhor pontuação no ranking",
  price_drop: "Fornecedor reduziu o custo deste produto",
  hysteresis_pass: "Diferença de preço suficiente para justificar a troca",
  hysteresis_fail: "Diferença de preço muito pequena para justificar troca",
  economy_opportunity: "Há um fornecedor mais barato disponível",
  no_offer: "Nenhum fornecedor tem oferta ativa para este produto",
  no_master_candidate: "Produto ainda não vinculado a um master",
  disabled: "Automação de sourcing está desligada",
  single_offer: "Apenas um fornecedor disponível",
  same_supplier: "Fornecedor já é o selecionado",
  guards_failed: "Troca não passou nas verificações de segurança",
  pricing_simulation_failed: "Não foi possível simular o impacto no preço de venda",
  margin_below_min: "A margem ficaria abaixo do mínimo permitido",
  ambiguous_ranking: "Dois ou mais fornecedores ficaram muito próximos no ranking",

  // Exception types
  review_match: "Produto de catálogo precisa de conferência manual",
  review_ranking: "Ranking dos fornecedores precisa de revisão humana",
  source_changed: "Fornecedor de origem do produto mudou",
  stale_sourcing: "Fornecedor atual ficou indisponível ou sem estoque",
  stale_publication: "Produto publicado com informações desatualizadas",
  inactive_item: "Item foi desativado no catálogo do fornecedor",

  // Price change reasons
  cost_increase: "Fornecedor aumentou o custo deste produto",
  cost_decrease: "Fornecedor reduziu o custo deste produto",
  margin_adjustment: "Margem recalculada conforme regra da seção",
  auto_price_update: "Preço de venda recalculado automaticamente",
  blocked_by_guard: "A troca aumentaria o preço acima do limite permitido",

  // Orchestrator phases
  normalize: "Normalização de catálogo",
  match: "Vinculação de produtos",
  offers: "Processamento de ofertas",
  inactive_items: "Verificação de itens inativos",
  detect_exceptions: "Detecção de pendências",
  persist_exceptions: "Registro de pendências",

  // Supplier replacement reasons
  sem_estoque: "Estoque do fornecedor zerou",
  indisponivel: "Fornecedor ficou indisponível",
  custo_menor: "Fornecedor mais barato encontrado",
  inelegivel: "Oferta do fornecedor deixou de ser válida",
  variacao_preco_excede_limite: "A troca aumentaria o preço acima do limite permitido",
  economy_sem_hysteresis: "Economia possível, mas aguardando confirmação",
  sem_fornecedor_elegivel: "Nenhum fornecedor elegível encontrado",
  ranking_ambiguo: "Dois fornecedores ficaram muito próximos no ranking",
};

export function translateReason(code: string | null): string {
  if (!code) return "—";
  return REASON_TRANSLATIONS[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Period helpers ───────────────────────────────────────────────────────

function periodToDate(period: string | undefined): string | null {
  if (!period || period === "todos") return null;
  const now = new Date();
  if (period === "hoje") {
    now.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    now.setDate(now.getDate() - 7);
  } else if (period === "30d") {
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString();
}

// ─── KPI summary ──────────────────────────────────────────────────────────

export async function getAutomacaoKpis(): Promise<AutomacaoKpis> {
  const sb = await createClient();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [replacements7d, priceChanges7d, openExceptions, lastRun] = await Promise.all([
    sb.from("supplier_replacement_log")
      .select("*", { count: "exact", head: true })
      .eq("auto_applied", true)
      .gte("created_at", since7d),
    sb.from("price_change_log")
      .select("*", { count: "exact", head: true })
      .eq("auto_applied", true)
      .gte("created_at", since7d),
    sb.from("procurement_exceptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    sb.from("procurement_audit_log")
      .select("run_id, action, detail, created_at")
      .eq("action", "orchestrator_complete")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const trocas = replacements7d.count ?? 0;
  const precos = priceChanges7d.count ?? 0;

  const run = lastRun.data?.[0] as { detail: Record<string, unknown>; created_at: string } | undefined;

  return {
    totalEventos7d: trocas + precos,
    trocasAuto7d: trocas,
    precosAuto7d: precos,
    excecoesAbertas: openExceptions.count ?? 0,
    ultimaExecucao: run?.created_at ?? null,
    ultimaExecucaoStatus: (run?.detail?.status as string) ?? null,
  };
}

// ─── Timeline aggregation ─────────────────────────────────────────────────

async function fetchReplacementEvents(sb: SB, since: string | null, limit: number): Promise<AutomacaoEvent[]> {
  let q = sb.from("supplier_replacement_log")
    .select("id, master_product_id, product_id, old_supplier_id, new_supplier_id, reason, old_cost_centavos, new_cost_centavos, price_change_pct, auto_applied, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: `repl_${r.id}`,
    type: "troca_fornecedor" as const,
    mode: r.auto_applied ? "automatico" as const : "manual" as const,
    timestamp: r.created_at,
    productName: null,
    productId: r.product_id,
    masterProductId: r.master_product_id,
    title: r.auto_applied ? "Troca automática de fornecedor" : "Troca manual de fornecedor",
    description: `Fornecedor alterado: ${r.old_supplier_id ?? "—"} → ${r.new_supplier_id ?? "—"}`,
    reason: translateReason(r.reason),
    reasonCode: r.reason,
    status: "aplicado" as const,
    supplierOld: r.old_supplier_id,
    supplierNew: r.new_supplier_id,
    priceOld: r.old_cost_centavos,
    priceNew: r.new_cost_centavos,
    changePct: r.price_change_pct ? Number(r.price_change_pct) : null,
    severity: null,
    detail: { old_offer_id: r.old_offer_id, new_offer_id: r.new_offer_id },
  }));
}

async function fetchPriceEvents(sb: SB, since: string | null, limit: number): Promise<AutomacaoEvent[]> {
  let q = sb.from("price_change_log")
    .select("id, product_id, master_product_id, supplier_id, old_cost_centavos, new_cost_centavos, old_price_centavos, new_price_centavos, change_pct, auto_applied, blocked, block_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const blocked = !!r.blocked;
    return {
      id: `price_${r.id}`,
      type: "alteracao_preco" as const,
      mode: r.auto_applied ? "automatico" as const : "manual" as const,
      timestamp: r.created_at,
      productName: null,
      productId: r.product_id,
      masterProductId: r.master_product_id,
      title: blocked ? "Alteração de preço bloqueada" : r.auto_applied ? "Preço recalculado automaticamente" : "Preço atualizado manualmente",
      description: `Custo: ${fmtCentavos(r.old_cost_centavos)} → ${fmtCentavos(r.new_cost_centavos)}` +
        (r.old_price_centavos ? ` · Venda: ${fmtCentavos(r.old_price_centavos)} → ${fmtCentavos(r.new_price_centavos)}` : ""),
      reason: blocked ? translateReason(r.block_reason) : "Custo atualizado pelo fornecedor",
      reasonCode: r.block_reason ?? null,
      status: blocked ? "bloqueado" as const : "aplicado" as const,
      supplierOld: null,
      supplierNew: r.supplier_id,
      priceOld: r.old_cost_centavos,
      priceNew: r.new_cost_centavos,
      changePct: r.change_pct ? Number(r.change_pct) : null,
      severity: blocked ? "high" : null,
      detail: { old_price: r.old_price_centavos, new_price: r.new_price_centavos },
    };
  });
}

async function fetchExceptionEvents(sb: SB, since: string | null, limit: number): Promise<AutomacaoEvent[]> {
  let q = sb.from("procurement_exceptions")
    .select("id, type, severity, status, entity_type, entity_id, master_product_id, supplier_id, title, detail, resolved_by, resolved_at, resolution_note, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const isResolved = r.status === "resolved" || r.status === "dismissed";
    const autoResolved = isResolved && !r.resolved_by && r.resolution_note === "Auto-resolvida";
    return {
      id: `exc_${r.id}`,
      type: isResolved ? "excecao_resolvida" as const : "excecao_detectada" as const,
      mode: autoResolved ? "automatico" as const : "manual" as const,
      timestamp: isResolved ? (r.resolved_at ?? r.updated_at ?? r.created_at) : r.created_at,
      productName: null,
      productId: r.entity_id,
      masterProductId: r.master_product_id,
      title: r.title ?? translateReason(r.type),
      description: r.title ? translateReason(r.type) : (r.detail?.message ?? ""),
      reason: translateReason(r.type),
      reasonCode: r.type,
      status: r.status === "open" ? "pendente" as const
        : r.status === "resolved" ? "resolvido" as const
        : "descartado" as const,
      supplierOld: null,
      supplierNew: r.supplier_id,
      priceOld: null,
      priceNew: null,
      changePct: null,
      severity: r.severity,
      detail: r.detail ?? {},
    };
  });
}

async function fetchSourcingEvents(sb: SB, since: string | null, limit: number): Promise<AutomacaoEvent[]> {
  let q = sb.from("sourcing_selections")
    .select("id, master_product_id, supplier_offer_id, selected_by, note, score, ambiguous, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const isAuto = typeof r.note === "string" && (r.note.startsWith("[auto-sourcing]") || r.note.startsWith("[auto-switch]"));
    return {
      id: `src_${r.id}`,
      type: "selecao_sourcing" as const,
      mode: isAuto ? "automatico" as const : "manual" as const,
      timestamp: r.created_at,
      productName: null,
      productId: null,
      masterProductId: r.master_product_id,
      title: isAuto ? "Fornecedor selecionado automaticamente" : "Fornecedor selecionado manualmente",
      description: r.note
        ? r.note.replace(/^\[(auto-sourcing|auto-switch)\]\s*/, "")
        : `Score: ${r.score ?? "—"}${r.ambiguous ? " (ambíguo)" : ""}`,
      reason: isAuto ? "Melhor pontuação no ranking" : "Seleção manual pelo operador",
      reasonCode: isAuto ? "best_score" : null,
      status: "aplicado" as const,
      supplierOld: null,
      supplierNew: null,
      priceOld: null,
      priceNew: null,
      changePct: null,
      severity: r.ambiguous ? "medium" : null,
      detail: { offer_id: r.supplier_offer_id, score: r.score, ambiguous: r.ambiguous },
    };
  });
}

async function fetchOrchestratorEvents(sb: SB, since: string | null, limit: number): Promise<AutomacaoEvent[]> {
  let q = sb.from("procurement_audit_log")
    .select("id, run_id, action, phase, detail, created_at")
    .in("action", ["orchestrator_complete", "orchestrator_start", "phase_error"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const d = r.detail ?? {};
    const isComplete = r.action === "orchestrator_complete";
    const isError = r.action === "phase_error";
    return {
      id: `orch_${r.id}`,
      type: "execucao_orquestrador" as const,
      mode: "automatico" as const,
      timestamp: r.created_at,
      productName: null,
      productId: null,
      masterProductId: null,
      title: isComplete
        ? `Automação concluída${d.status === "completed" ? "" : d.status === "partial" ? " (parcial)" : d.status ? ` (${d.status})` : ""}`
        : isError
        ? `Erro na fase: ${translateReason(r.phase) || r.phase || "desconhecida"}`
        : "Automação iniciada",
      description: isComplete
        ? `${d.exceptions_created ?? 0} pendência(s) criada(s), ${d.exceptions_auto_resolved ?? 0} resolvida(s) automaticamente${d.duration_ms ? ` — ${Math.round(d.duration_ms / 1000)}s` : ""}`
        : isError
        ? `${d.error ?? "Erro desconhecido durante a execução"}`
        : `Execução ${r.run_id?.slice(0, 8) ?? "—"}`,
      reason: isComplete ? "Execução automática do pipeline" : isError ? "Falha durante a execução" : "Pipeline de compras iniciado",
      reasonCode: r.action,
      status: isError ? "bloqueado" as const : "aplicado" as const,
      supplierOld: null,
      supplierNew: null,
      priceOld: null,
      priceNew: null,
      changePct: null,
      severity: isError ? "high" : null,
      detail: d,
    };
  });
}

// ─── Name resolution ─────────────────────────────────────────────────────

async function resolveNames(sb: SB, events: AutomacaoEvent[]): Promise<void> {
  const masterIds = new Set<string>();
  const supplierIds = new Set<string>();

  for (const e of events) {
    if (e.masterProductId) masterIds.add(e.masterProductId);
    if (e.supplierOld && !e.supplierOld.includes(" ")) supplierIds.add(e.supplierOld);
    if (e.supplierNew && !e.supplierNew.includes(" ")) supplierIds.add(e.supplierNew);
  }

  const [products, suppliers] = await Promise.all([
    masterIds.size > 0
      ? sb.from("master_products").select("id, name").in("id", [...masterIds])
      : { data: [] },
    supplierIds.size > 0
      ? sb.from("suppliers").select("id, name").in("id", [...supplierIds])
      : { data: [] },
  ]);

  const productMap = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (products.data ?? []) as any[]) productMap.set(p.id, p.name);

  const supplierMap = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (suppliers.data ?? []) as any[]) supplierMap.set(s.id, s.name);

  for (const e of events) {
    if (e.masterProductId) {
      const name = productMap.get(e.masterProductId);
      if (name && (!e.productName || e.productName === e.productId || e.productName === e.masterProductId)) {
        e.productName = name;
      }
    }
    if (e.supplierOld) {
      const oldName = supplierMap.get(e.supplierOld);
      if (oldName) {
        e.description = e.description.replaceAll(e.supplierOld, oldName);
        e.supplierOld = oldName;
      }
    }
    if (e.supplierNew) {
      const newName = supplierMap.get(e.supplierNew);
      if (newName) {
        e.description = e.description.replaceAll(e.supplierNew, newName);
        e.supplierNew = newName;
      }
    }
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────

function deduplicateEvents(events: AutomacaoEvent[]): AutomacaoEvent[] {
  const replacementKeys = new Set<string>();
  for (const e of events) {
    if (e.type === "troca_fornecedor" && e.masterProductId) {
      replacementKeys.add(`${e.masterProductId}|${Math.floor(new Date(e.timestamp).getTime() / 60000)}`);
    }
  }

  return events.filter((e) => {
    if (e.type !== "selecao_sourcing" || !e.masterProductId) return true;
    const key = `${e.masterProductId}|${Math.floor(new Date(e.timestamp).getTime() / 60000)}`;
    return !replacementKeys.has(key);
  });
}

// ─── Main timeline query ──────────────────────────────────────────────────

export async function getAutomacaoTimeline(
  filters: AutomacaoFilters = {},
): Promise<{ events: AutomacaoEvent[]; total: number }> {
  const sb = await createClient();
  const since = periodToDate(filters.period ?? "30d");
  const perPage = filters.perPage ?? 50;
  const fetchLimit = 200;

  const fetchers: Promise<AutomacaoEvent[]>[] = [];
  const typeFilter = filters.type;

  if (!typeFilter || typeFilter === "troca_fornecedor") {
    fetchers.push(fetchReplacementEvents(sb, since, fetchLimit));
  }
  if (!typeFilter || typeFilter === "alteracao_preco") {
    fetchers.push(fetchPriceEvents(sb, since, fetchLimit));
  }
  if (!typeFilter || typeFilter === "excecao_detectada" || typeFilter === "excecao_resolvida") {
    fetchers.push(fetchExceptionEvents(sb, since, fetchLimit));
  }
  if (!typeFilter || typeFilter === "selecao_sourcing") {
    fetchers.push(fetchSourcingEvents(sb, since, fetchLimit));
  }
  if (!typeFilter || typeFilter === "execucao_orquestrador") {
    fetchers.push(fetchOrchestratorEvents(sb, since, fetchLimit));
  }

  const results = await Promise.all(fetchers);
  let allEvents = deduplicateEvents(results.flat());

  await resolveNames(sb, allEvents);

  if (filters.mode) {
    allEvents = allEvents.filter((e) => e.mode === filters.mode);
  }
  if (filters.status) {
    allEvents = allEvents.filter((e) => e.status === filters.status);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    allEvents = allEvents.filter(
      (e) =>
        (e.productName?.toLowerCase().includes(q)) ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.reason.toLowerCase().includes(q) ||
        (e.supplierOld?.toLowerCase().includes(q)) ||
        (e.supplierNew?.toLowerCase().includes(q)),
    );
  }

  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = allEvents.length;
  const page = filters.page ?? 1;
  const start = (page - 1) * perPage;
  const events = allEvents.slice(start, start + perPage);

  return { events, total };
}

// ─── Product history ──────────────────────────────────────────────────────

export async function getProductHistory(masterProductId: string): Promise<ProductHistory> {
  const sb = await createClient();

  const [replacements, prices, exceptions, sourcings] = await Promise.all([
    fetchReplacementEvents(sb, null, 100),
    fetchPriceEvents(sb, null, 100),
    fetchExceptionEvents(sb, null, 100),
    fetchSourcingEvents(sb, null, 100),
  ]);

  const merged = deduplicateEvents([...replacements, ...prices, ...exceptions, ...sourcings]);
  const filtered = merged
    .filter((e) => e.masterProductId === masterProductId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  await resolveNames(sb, filtered);

  const name = filtered.find((e) => e.productName && e.productName !== e.productId)?.productName ?? masterProductId;

  return { masterProductId, productName: name, events: filtered };
}

// ─── Dashboard widget for /admin/compras ──────────────────────────────────

export interface AutomacaoWidget {
  trocasAuto24h: number;
  precosAuto24h: number;
  excecoesAbertas: number;
  ultimaExecucao: string | null;
}

export async function getAutomacaoWidget(): Promise<AutomacaoWidget> {
  const sb = await createClient();
  const since24h = new Date(Date.now() - 86_400_000).toISOString();

  const [trocas, precos, excecoes, lastRun] = await Promise.all([
    sb.from("supplier_replacement_log")
      .select("*", { count: "exact", head: true })
      .eq("auto_applied", true)
      .gte("created_at", since24h),
    sb.from("price_change_log")
      .select("*", { count: "exact", head: true })
      .eq("auto_applied", true)
      .gte("created_at", since24h),
    sb.from("procurement_exceptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    sb.from("procurement_audit_log")
      .select("created_at")
      .eq("action", "orchestrator_complete")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  return {
    trocasAuto24h: trocas.count ?? 0,
    precosAuto24h: precos.count ?? 0,
    excecoesAbertas: excecoes.count ?? 0,
    ultimaExecucao: lastRun.data?.[0]?.created_at ?? null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtCentavos(v: number | null): string {
  if (v == null) return "—";
  return `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
}
