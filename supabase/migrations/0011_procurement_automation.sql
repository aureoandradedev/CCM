-- ============================================================================
-- CCM · Fase 9 — Automação do Comprador (v2)
-- ============================================================================
--
-- Orquestrador que automatiza o pipeline interno de compras:
--   catálogo → normalização → matching → supplier_offers → ranking → fila de exceções
--
-- Regras:
--   - Só automatiza decisões seguras/determinísticas
--   - Ambiguidade → revisão humana (procurement_exceptions)
--   - NUNCA publica, NUNCA escolhe sourcing, NUNCA muda margem automaticamente
--
-- Concorrência: lease persistente (orchestrator_lease), sem Redis
-- Versionamento: supplier_offers com replaced_at (close+create, não UPDATE)
-- Idempotência: fingerprint + status='open' UNIQUE garante dedup

-- ============================================================================
-- 1. TABELA DE EXCEÇÕES (fila de revisão humana)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.procurement_exceptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  type              text NOT NULL
                    CHECK (type IN (
                      'review_match',
                      'review_ranking',
                      'no_offer',
                      'source_changed',
                      'economy_opportunity',
                      'stale_sourcing',
                      'stale_publication',
                      'inactive_item'
                    )),

  severity          text NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved', 'dismissed')),

  entity_type       text NOT NULL,
  entity_id         text NOT NULL,
  master_product_id uuid REFERENCES public.master_products(id) ON DELETE CASCADE,
  supplier_id       text REFERENCES public.suppliers(id) ON DELETE CASCADE,

  title             text NOT NULL,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint       text NOT NULL,

  resolved_by       uuid REFERENCES public.profiles(id),
  resolved_at       timestamptz,
  resolution_note   text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS exceptions_fingerprint_open_idx
  ON public.procurement_exceptions (fingerprint)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS exceptions_status_type_idx
  ON public.procurement_exceptions (status, type);

CREATE INDEX IF NOT EXISTS exceptions_master_product_idx
  ON public.procurement_exceptions (master_product_id)
  WHERE master_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS exceptions_severity_idx
  ON public.procurement_exceptions (severity, created_at DESC)
  WHERE status = 'open';

CREATE TRIGGER procurement_exceptions_updated_at
  BEFORE UPDATE ON public.procurement_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.procurement_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all procurement_exceptions" ON public.procurement_exceptions;
CREATE POLICY "admin all procurement_exceptions"
  ON public.procurement_exceptions FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.procurement_exceptions FROM anon;

-- ============================================================================
-- 2. TABELA DE AUDITORIA DO ORQUESTRADOR
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.procurement_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      text NOT NULL,
  action      text NOT NULL,
  phase       text,
  entity_type text,
  entity_id   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_audit_run_idx
  ON public.procurement_audit_log (run_id, created_at);

CREATE INDEX IF NOT EXISTS procurement_audit_action_idx
  ON public.procurement_audit_log (action, created_at DESC);

ALTER TABLE public.procurement_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read procurement_audit_log" ON public.procurement_audit_log;
CREATE POLICY "admin read procurement_audit_log"
  ON public.procurement_audit_log FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin insert procurement_audit_log" ON public.procurement_audit_log;
CREATE POLICY "admin insert procurement_audit_log"
  ON public.procurement_audit_log FOR INSERT
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.procurement_audit_log FROM anon;

-- ============================================================================
-- 3. LEASE DO ORQUESTRADOR (concorrência persistente)
-- ============================================================================
-- Substitui pg_try_advisory_xact_lock: o lease dura além da transação/RPC.
-- TTL para stale recovery (processo que morreu sem liberar).

CREATE TABLE IF NOT EXISTS public.orchestrator_lease (
  lock_key    text PRIMARY KEY DEFAULT 'ccm_orchestrator',
  run_id      text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

ALTER TABLE public.orchestrator_lease ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin all orchestrator_lease" ON public.orchestrator_lease;
CREATE POLICY "admin all orchestrator_lease"
  ON public.orchestrator_lease FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.orchestrator_lease FROM anon;

-- ── Adquirir lease ──
-- Atômico via FOR UPDATE. Recupera leases expirados (stale recovery).
-- Retorna { acquired: true } ou { acquired: false, held_by, expires_at }.
CREATE OR REPLACE FUNCTION public.acquire_orchestrator_lease(
  p_run_id       text,
  p_ttl_seconds  int DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now     timestamptz := now();
  v_expires timestamptz := v_now + (p_ttl_seconds || ' seconds')::interval;
  v_existing record;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT * INTO v_existing
    FROM orchestrator_lease
   WHERE lock_key = 'ccm_orchestrator'
     FOR UPDATE;

  IF v_existing IS NULL THEN
    INSERT INTO orchestrator_lease (lock_key, run_id, acquired_at, expires_at)
    VALUES ('ccm_orchestrator', p_run_id, v_now, v_expires);
    RETURN jsonb_build_object('acquired', true);
  END IF;

  IF v_existing.expires_at < v_now THEN
    UPDATE orchestrator_lease SET
      run_id      = p_run_id,
      acquired_at = v_now,
      expires_at  = v_expires
    WHERE lock_key = 'ccm_orchestrator';
    RETURN jsonb_build_object('acquired', true, 'recovered_from', v_existing.run_id);
  END IF;

  RETURN jsonb_build_object(
    'acquired', false,
    'held_by', v_existing.run_id,
    'expires_at', v_existing.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_orchestrator_lease FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_orchestrator_lease FROM anon;
GRANT EXECUTE ON FUNCTION public.acquire_orchestrator_lease TO authenticated;

-- ── Liberar lease ──
-- Só libera se run_id corresponde (processo A não libera lease de B).
CREATE OR REPLACE FUNCTION public.release_orchestrator_lease(
  p_run_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  DELETE FROM orchestrator_lease
  WHERE lock_key = 'ccm_orchestrator'
    AND run_id = p_run_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'Lease nao pertence a este run_id.');
  END IF;

  RETURN jsonb_build_object('released', true);
END;
$$;

REVOKE ALL ON FUNCTION public.release_orchestrator_lease FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_orchestrator_lease FROM anon;
GRANT EXECUTE ON FUNCTION public.release_orchestrator_lease TO authenticated;

-- ── Renovar lease ──
-- Estende expires_at somente se run_id ainda é o owner.
-- Protege contra expiração durante execução longa (> TTL original).
-- Retorna { renewed: false } se perdeu ownership → caller deve abortar.
CREATE OR REPLACE FUNCTION public.renew_orchestrator_lease(
  p_run_id       text,
  p_ttl_seconds  int DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now     timestamptz := now();
  v_expires timestamptz := v_now + (p_ttl_seconds || ' seconds')::interval;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  UPDATE orchestrator_lease SET
    expires_at = v_expires
  WHERE lock_key = 'ccm_orchestrator'
    AND run_id = p_run_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('renewed', false, 'reason', 'Lease nao pertence a este run_id ou foi removido.');
  END IF;

  RETURN jsonb_build_object('renewed', true, 'expires_at', v_expires);
END;
$$;

REVOKE ALL ON FUNCTION public.renew_orchestrator_lease FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_orchestrator_lease FROM anon;
GRANT EXECUTE ON FUNCTION public.renew_orchestrator_lease TO authenticated;

-- ============================================================================
-- 4. VERSIONAMENTO DE SUPPLIER_OFFERS
-- ============================================================================
-- Adiciona replaced_at para distinguir "versão corrente" de "histórica".
-- status continua com semântica comercial (ativa/indisponivel/vencida/escolhida).
-- replaced_at != NULL = versão antiga substituída por dados atualizados.

ALTER TABLE public.supplier_offers
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz;

COMMENT ON COLUMN public.supplier_offers.replaced_at IS
  'Quando esta versão foi substituída por nova. NULL = versão corrente. Status comercial permanece inalterado.';

-- Atualiza o unique index: apenas uma oferta corrente ativa por (supplier, master_product)
DROP INDEX IF EXISTS offers_unique_active_idx;
CREATE UNIQUE INDEX offers_unique_active_idx
  ON public.supplier_offers (master_product_id, supplier_id)
  WHERE status = 'ativa' AND replaced_at IS NULL;

-- Índice para consultas de ofertas correntes
CREATE INDEX IF NOT EXISTS offers_current_active_idx
  ON public.supplier_offers (master_product_id, supplier_id, status)
  WHERE replaced_at IS NULL;

-- ── 4a. Atualizar select_sourcing_offer com filtro replaced_at ──
-- Agora que supplier_offers tem replaced_at, redefinir para exigir replaced_at IS NULL.
CREATE OR REPLACE FUNCTION public.select_sourcing_offer(
  p_master_product_id uuid,
  p_supplier_offer_id uuid,
  p_selected_by       uuid,
  p_note              text    DEFAULT NULL,
  p_score             numeric DEFAULT NULL,
  p_ambiguous         boolean DEFAULT false,
  p_ranking_snapshot  jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supplier_offers
    WHERE id = p_supplier_offer_id
      AND master_product_id = p_master_product_id
      AND status = 'ativa'
      AND replaced_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Oferta não encontrada, não está ativa ou foi substituída por nova versão.';
  END IF;

  UPDATE sourcing_selections
  SET replaced_at = now()
  WHERE master_product_id = p_master_product_id
    AND replaced_at IS NULL;

  INSERT INTO sourcing_selections (
    master_product_id, supplier_offer_id, selected_by,
    note, score, ambiguous, ranking_snapshot
  ) VALUES (
    p_master_product_id, p_supplier_offer_id, p_selected_by,
    p_note, p_score, p_ambiguous, p_ranking_snapshot
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── 4b. Atualizar publish_product com bloqueio de oferta substituída ──
-- Agora que supplier_offers tem replaced_at, redefinir publish_product para
-- bloquear publicação quando a oferta referenciada foi substituída por nova versão.
-- Defense-in-depth: TypeScript (publishPreview) e select_sourcing_offer já cobrem,
-- mas a camada SQL deve ser autossuficiente.

CREATE OR REPLACE FUNCTION public.publish_product(
  p_master_product_id      uuid,
  p_sourcing_selection_id  uuid,
  p_margin_rule_id         uuid,
  p_expected_cost_centavos int,
  p_expected_retail_centavos int,
  p_product_id             text,
  p_product_slug           text,
  p_product_sku            text,
  p_note                   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id             uuid;
  v_mp                   record;
  v_sel                  record;
  v_offer                record;
  v_cost                 int;
  v_offer_stock          int;
  v_resolved_rule_id     uuid;
  v_resolved_priority    int;
  v_tie_count            int;
  v_rule                 record;
  v_margin_pct           numeric(6,2);
  v_raw_price            int;
  v_rounded_price        int;
  v_retail_price         numeric(12,2);
  v_rounding             text;
  v_min_price            int;
  v_existing_id          text;
  v_existing_offer_id    uuid;
  v_existing_stock       int;
  v_is_republish         boolean;
  v_same_offer           boolean;
  v_stock                int;
  v_stock_status         text;
  v_stock_action         text;
  v_stock_before         int;
  v_final_product_id     text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT * INTO v_mp FROM master_products WHERE id = p_master_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Produto mestre nao encontrado.');
  END IF;
  IF v_mp.name IS NULL OR v_mp.name = '' THEN
    RETURN jsonb_build_object('error', 'Produto mestre sem nome.');
  END IF;

  SELECT * INTO v_sel
    FROM sourcing_selections
   WHERE master_product_id = p_master_product_id
     AND replaced_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nenhuma selecao de sourcing ativa.');
  END IF;
  IF v_sel.id != p_sourcing_selection_id THEN
    RETURN jsonb_build_object('error', 'Selecao alterada desde o preview. Revise antes de publicar.');
  END IF;

  SELECT * INTO v_offer FROM supplier_offers WHERE id = v_sel.supplier_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Oferta selecionada nao encontrada.');
  END IF;
  -- [0011] Bloqueio de oferta substituída (replaced_at)
  IF v_offer.replaced_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Oferta foi substituida por nova versao. Selecione a versao atual antes de publicar.');
  END IF;
  IF v_offer.status != 'ativa' THEN
    RETURN jsonb_build_object('error', format('Oferta com status %L (esperado: ativa).', v_offer.status));
  END IF;

  v_cost := v_offer.cost_centavos;
  IF v_cost <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido (zero ou negativo).');
  END IF;
  v_offer_stock := v_offer.stock;

  IF v_cost != p_expected_cost_centavos THEN
    RETURN jsonb_build_object('error',
      format('Custo da oferta mudou desde o preview (esperado: %s, atual: %s). Revise antes de publicar.',
        p_expected_cost_centavos, v_cost));
  END IF;

  SELECT id, winning_offer_id, stock
    INTO v_existing_id, v_existing_offer_id, v_existing_stock
    FROM products
   WHERE master_product_id = p_master_product_id
     AND publish_status IN ('publicada','rascunho','aguardando_aprovacao');

  v_is_republish := v_existing_id IS NOT NULL;
  v_same_offer := v_is_republish AND v_existing_offer_id = v_offer.id;
  v_final_product_id := COALESCE(v_existing_id, p_product_id);

  IF NOT v_is_republish THEN
    v_stock := v_offer_stock;
    v_stock_action := 'initialized';
    v_stock_before := NULL;
  ELSIF v_same_offer THEN
    v_stock := v_existing_stock;
    v_stock_action := 'preserved';
    v_stock_before := v_existing_stock;
  ELSE
    v_stock := v_offer_stock;
    v_stock_action := 'reinitialized';
    v_stock_before := v_existing_stock;
  END IF;

  IF v_stock_action IN ('initialized', 'reinitialized') THEN
    IF v_offer_stock IS NOT NULL AND v_offer_stock <= 0 THEN
      RETURN jsonb_build_object('error', 'Estoque zerado na oferta.');
    END IF;
  END IF;

  v_resolved_rule_id := NULL;

  SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
    FROM margin_rules
   WHERE active = true AND scope = 'product'
     AND scope_ref = p_master_product_id::text
   ORDER BY priority DESC
   LIMIT 1;

  IF v_resolved_rule_id IS NOT NULL THEN
    SELECT count(*) INTO v_tie_count
      FROM margin_rules
     WHERE active = true AND scope = 'product'
       AND scope_ref = p_master_product_id::text
       AND priority = v_resolved_priority;
    IF v_tie_count > 1 THEN
      RETURN jsonb_build_object('error',
        format('Margem ambigua: %s regras empatadas no escopo produto (prioridade %s).', v_tie_count, v_resolved_priority));
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL AND v_mp.category_slug IS NOT NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules
     WHERE active = true AND scope = 'category'
       AND scope_ref = v_mp.category_slug
     ORDER BY priority DESC
     LIMIT 1;

    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count
        FROM margin_rules
       WHERE active = true AND scope = 'category'
         AND scope_ref = v_mp.category_slug
         AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo categoria (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules
     WHERE active = true AND scope = 'global'
     ORDER BY priority DESC
     LIMIT 1;

    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count
        FROM margin_rules
       WHERE active = true AND scope = 'global'
         AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo global (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Nenhuma regra de margem aplicavel.');
  END IF;

  IF v_resolved_rule_id != p_margin_rule_id THEN
    RETURN jsonb_build_object('error', 'Regra de margem vencedora mudou desde o preview. Revise antes de publicar.');
  END IF;

  SELECT * INTO v_rule FROM margin_rules WHERE id = v_resolved_rule_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Regra de margem nao encontrada ou inativa.');
  END IF;

  v_margin_pct := v_rule.margin_pct;
  v_raw_price := round(v_cost * (1.0 + v_margin_pct / 100.0))::int;
  v_rounding := v_rule.rounding;
  v_min_price := v_rule.min_price_centavos;

  v_rounded_price := v_raw_price;
  IF v_rounding = 'X90' THEN
    v_rounded_price := (v_raw_price / 100) * 100 + 90;
    IF v_rounded_price < v_raw_price THEN
      v_rounded_price := v_rounded_price + 100;
    END IF;
  ELSIF v_rounding = 'X99' THEN
    v_rounded_price := (v_raw_price / 100) * 100 + 99;
    IF v_rounded_price < v_raw_price THEN
      v_rounded_price := v_rounded_price + 100;
    END IF;
  END IF;

  IF v_rounded_price < v_cost THEN
    v_rounded_price := v_cost;
  END IF;
  IF v_min_price IS NOT NULL AND v_rounded_price < v_min_price THEN
    v_rounded_price := v_min_price;
  END IF;

  v_retail_price := v_rounded_price / 100.0;

  IF v_rounded_price != p_expected_retail_centavos THEN
    RETURN jsonb_build_object('error',
      format('Preco calculado difere do revisado (esperado: %s ctv, calculado: %s ctv). Parametros da regra podem ter mudado. Revise antes de publicar.',
        p_expected_retail_centavos, v_rounded_price));
  END IF;

  IF v_stock IS NOT NULL AND v_stock > 0 THEN
    v_stock_status := 'in_stock';
  ELSIF v_stock IS NULL THEN
    v_stock_status := 'supplier';
  ELSE
    v_stock_status := 'out';
  END IF;

  IF v_is_republish THEN
    UPDATE products SET
      slug = p_product_slug,
      sku = p_product_sku,
      ean = v_mp.ean,
      name = v_mp.name,
      brand_slug = v_mp.brand_slug,
      brand_name = COALESCE(v_mp.brand_name, ''),
      category_slug = v_mp.category_slug,
      subcategory_slug = v_mp.subcategory_slug,
      supplier_id = v_offer.supplier_id,
      unit = COALESCE(v_mp.unit, 'un'),
      pack_info = v_mp.pack_info,
      retail_price = v_retail_price,
      description = v_mp.description,
      short_description = COALESCE(left(v_mp.description, 200), v_mp.name),
      specs = COALESCE(v_mp.specs, '[]'::jsonb),
      images = COALESCE(v_mp.images, '{}'::text[]),
      tags = COALESCE(v_mp.tags, '{}'::text[]),
      stock = v_stock,
      stock_status = v_stock_status,
      master_product_id = p_master_product_id,
      winning_offer_id = v_offer.id,
      cost_centavos = v_cost,
      margin_pct = v_margin_pct,
      publish_status = 'publicada',
      sourcing_selection_id = v_sel.id,
      offer_approved_by = v_admin_id,
      offer_approved_at = now(),
      offer_approval_note = p_note,
      offer_score = NULL,
      active = true,
      updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO products (
      id, slug, sku, ean, name, brand_slug, brand_name,
      category_slug, subcategory_slug, supplier_id, unit, pack_info,
      retail_price, description, short_description, specs, images, tags,
      stock, stock_status, master_product_id, winning_offer_id,
      cost_centavos, margin_pct, publish_status, sourcing_selection_id,
      offer_approved_by, offer_approved_at, offer_approval_note, offer_score,
      active
    ) VALUES (
      p_product_id, p_product_slug, p_product_sku, v_mp.ean, v_mp.name,
      v_mp.brand_slug, COALESCE(v_mp.brand_name, ''),
      v_mp.category_slug, v_mp.subcategory_slug, v_offer.supplier_id,
      COALESCE(v_mp.unit, 'un'), v_mp.pack_info,
      v_retail_price, v_mp.description,
      COALESCE(left(v_mp.description, 200), v_mp.name),
      COALESCE(v_mp.specs, '[]'::jsonb),
      COALESCE(v_mp.images, '{}'::text[]),
      COALESCE(v_mp.tags, '{}'::text[]),
      v_stock, v_stock_status, p_master_product_id, v_offer.id,
      v_cost, v_margin_pct, 'publicada', v_sel.id,
      v_admin_id, now(), p_note, NULL,
      true
    );
  END IF;

  INSERT INTO publication_log (
    product_id, master_product_id, sourcing_selection_id,
    supplier_offer_id, supplier_id, published_by,
    cost_centavos, margin_pct, margin_rule_id, retail_price,
    rounding, note, action,
    stock_before, offer_stock, stock_after, stock_action
  ) VALUES (
    v_final_product_id, p_master_product_id, v_sel.id,
    v_offer.id, v_offer.supplier_id, v_admin_id,
    v_cost, v_margin_pct, v_rule.id, v_retail_price,
    v_rounding, p_note,
    CASE
      WHEN NOT v_is_republish THEN 'publish'
      WHEN v_same_offer THEN 'update_price'
      ELSE 'republish'
    END,
    v_stock_before, v_offer_stock, v_stock, v_stock_action
  );

  RETURN jsonb_build_object(
    'ok', CASE
      WHEN NOT v_is_republish THEN 'Produto publicado com sucesso.'
      WHEN v_same_offer THEN 'Produto atualizado com sucesso.'
      ELSE 'Produto republicado com sucesso (nova oferta).'
    END,
    'product_id', v_final_product_id,
    'retail_price', v_retail_price,
    'stock_action', v_stock_action
  );
END;
$$;

-- ============================================================================
-- 5. VERSIONAR OFERTA (close + create, preserva histórico)
-- ============================================================================
-- Substitui upsert_supplier_offer. Quando dados comerciais mudam:
--   1. Oferta anterior: replaced_at = now() (status permanece, era comercialmente válida)
--   2. Nova oferta: INSERT com status='ativa', replaced_at=NULL
-- Quando nada muda: retorna 'unchanged'. Atomicamente.

CREATE OR REPLACE FUNCTION public.version_supplier_offer(
  p_master_product_id  uuid,
  p_supplier_id        text,
  p_catalog_item_id    uuid,
  p_cost_centavos      int,
  p_stock              int DEFAULT NULL,
  p_lead_time_days     int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_new_id   uuid;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_cost_centavos <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido.');
  END IF;

  SELECT id, cost_centavos, stock, lead_time_days, catalog_item_id
    INTO v_existing
    FROM supplier_offers
   WHERE master_product_id = p_master_product_id
     AND supplier_id = p_supplier_id
     AND status = 'ativa'
     AND replaced_at IS NULL;

  IF v_existing IS NULL THEN
    INSERT INTO supplier_offers (
      master_product_id, supplier_id, catalog_item_id,
      cost_centavos, stock, lead_time_days, status
    ) VALUES (
      p_master_product_id, p_supplier_id, p_catalog_item_id,
      p_cost_centavos, p_stock, p_lead_time_days, 'ativa'
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_new_id, 'action', 'created'
    );
  END IF;

  IF v_existing.cost_centavos = p_cost_centavos
     AND v_existing.stock IS NOT DISTINCT FROM p_stock
     AND v_existing.lead_time_days = p_lead_time_days THEN
    IF v_existing.catalog_item_id IS DISTINCT FROM p_catalog_item_id THEN
      UPDATE supplier_offers SET catalog_item_id = p_catalog_item_id, updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_existing.id, 'action', 'unchanged'
    );
  END IF;

  -- Dados comerciais mudaram: fechar versão anterior, criar nova
  UPDATE supplier_offers SET replaced_at = now(), updated_at = now()
  WHERE id = v_existing.id;

  INSERT INTO supplier_offers (
    master_product_id, supplier_id, catalog_item_id,
    cost_centavos, stock, lead_time_days, status
  ) VALUES (
    p_master_product_id, p_supplier_id, p_catalog_item_id,
    p_cost_centavos, p_stock, p_lead_time_days, 'ativa'
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'offer_id', v_new_id,
    'action', 'versioned',
    'previous_offer_id', v_existing.id,
    'previous_cost', v_existing.cost_centavos,
    'previous_stock', v_existing.stock,
    'previous_lead_time', v_existing.lead_time_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.version_supplier_offer FROM PUBLIC;
REVOKE ALL ON FUNCTION public.version_supplier_offer FROM anon;
GRANT EXECUTE ON FUNCTION public.version_supplier_offer TO authenticated;

-- ============================================================================
-- 6. RESOLVER EXCEÇÃO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_procurement_exception(
  p_exception_id    uuid,
  p_resolution      text DEFAULT 'resolved',
  p_note            text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_resolution NOT IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('error', 'Resolucao invalida.');
  END IF;

  UPDATE procurement_exceptions SET
    status          = p_resolution,
    resolved_by     = v_admin_id,
    resolved_at     = now(),
    resolution_note = p_note
  WHERE id = p_exception_id
    AND status = 'open';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Excecao nao encontrada ou ja resolvida.');
  END IF;

  RETURN jsonb_build_object('ok', 'Excecao resolvida.');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_procurement_exception FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_procurement_exception FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_procurement_exception TO authenticated;

-- ============================================================================
-- 7. MARCAR OFERTAS COMO INDISPONÍVEL (itens inativos)
-- ============================================================================
-- Somente ofertas correntes (replaced_at IS NULL).
-- Histórico de versões anteriores não é afetado.

CREATE OR REPLACE FUNCTION public.deactivate_offers_for_inactive_items(
  p_supplier_id text
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  UPDATE supplier_offers so SET
    status = 'indisponivel',
    updated_at = now()
  FROM supplier_catalog_items sci
  WHERE so.catalog_item_id = sci.id
    AND so.supplier_id = p_supplier_id
    AND so.status = 'ativa'
    AND so.replaced_at IS NULL
    AND sci.source_active = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_offers_for_inactive_items FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_offers_for_inactive_items FROM anon;
GRANT EXECUTE ON FUNCTION public.deactivate_offers_for_inactive_items TO authenticated;

-- ============================================================================
-- 8. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.procurement_exceptions IS
  'Fila de exceções do orquestrador de compras. Itens que precisam de revisão humana.';

COMMENT ON COLUMN public.procurement_exceptions.fingerprint IS
  'Chave de dedup: mesma exceção não abre duas vezes enquanto status=open.';

COMMENT ON COLUMN public.procurement_exceptions.type IS
  'review_match=match pendente, review_ranking=ranking ambíguo, no_offer=sem oferta ativa, source_changed=dados do fornecedor mudaram (nova versão de oferta), economy_opportunity=oferta mais barata disponível, stale_sourcing=seleção desatualizada, stale_publication=publicação desatualizada, inactive_item=item inativo do fornecedor.';

COMMENT ON TABLE public.procurement_audit_log IS
  'Log imutável de cada execução do orquestrador de compras.';

COMMENT ON TABLE public.orchestrator_lease IS
  'Lease persistente do orquestrador. Exatamente 1 linha (lock_key=ccm_orchestrator). TTL para stale recovery.';

COMMENT ON FUNCTION public.acquire_orchestrator_lease IS
  'Tenta adquirir lease do orquestrador. Fail-closed: se falhar, orquestrador não executa. Recupera lease expirado (stale recovery).';

COMMENT ON FUNCTION public.release_orchestrator_lease IS
  'Libera lease do orquestrador somente se run_id corresponde. Processo A não libera lease de B.';

COMMENT ON FUNCTION public.renew_orchestrator_lease IS
  'Renova TTL do lease somente se run_id ainda é owner. Protege contra expiração em execuções longas. Retorna renewed=false se perdeu ownership.';

COMMENT ON FUNCTION public.version_supplier_offer IS
  'Cria nova versão de oferta preservando histórico. Dados mudam → close anterior (replaced_at) + nova ativa. Atômica.';

COMMENT ON FUNCTION public.resolve_procurement_exception IS
  'Resolve ou dispensa uma exceção aberta. Admin only.';

COMMENT ON FUNCTION public.deactivate_offers_for_inactive_items IS
  'Marca ofertas correntes como indisponível quando item ficou inativo (source_active=false). Histórico não é afetado.';
