-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0043: Compras role operational access
--
-- Context: Migration 0041 gave compras role READ on five tables:
--   supplier_catalog_items (SELECT+UPDATE), suppliers (SELECT),
--   supplier_purchase_orders (SELECT+UPDATE), supplier_commercial_terms (SELECT),
--   matching_bindings (SELECT).
--
-- Problem: Compras area pages need access to many more tables for full
-- operational workflow (catalogs, PO items, exceptions, inventory, offers, etc.)
--
-- Solution: Add targeted RLS policies per table. Compras sees costs/prices
-- (that's their job) but NOT ccm_configs, fiscal_documents, receiving_sessions,
-- shipment_occurrences, collaborator data, or security settings.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. master_products: compras SELECT + INSERT (create master from catalog item)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads master products"
  ON public.master_products FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

CREATE POLICY "compras inserts master products"
  ON public.master_products FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. supplier_catalogs: compras SELECT (catalog list page)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads supplier catalogs"
  ON public.supplier_catalogs FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. purchase_order_items: compras SELECT (PO detail)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads purchase order items"
  ON public.purchase_order_items FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. operational_exceptions: compras SELECT + UPDATE (resolve/dismiss)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads operational exceptions"
  ON public.operational_exceptions FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

CREATE POLICY "compras updates operational exceptions"
  ON public.operational_exceptions FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['compras']))
  WITH CHECK (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. exception_links: compras SELECT
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads exception links"
  ON public.exception_links FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. ccm_inventory: compras SELECT (view leftover stock)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads ccm inventory"
  ON public.ccm_inventory FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. sourcing_selections: compras SELECT (view active sourcing)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads sourcing selections"
  ON public.sourcing_selections FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. supplier_offers: compras SELECT (view offers for comparison)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads supplier offers"
  ON public.supplier_offers FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. margin_rules: compras SELECT (view margin rules for publishing)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads margin rules"
  ON public.margin_rules FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. price_change_log: compras SELECT (view price history)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads price change log"
  ON public.price_change_log FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. supplier_replacement_log: compras SELECT (view supplier switches)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads supplier replacement log"
  ON public.supplier_replacement_log FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. supplier_performance_events: compras SELECT (observational)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads supplier performance events"
  ON public.supplier_performance_events FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. purchase_requirements: compras SELECT (PO generation context)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads purchase requirements"
  ON public.purchase_requirements FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. publication_log: compras SELECT (view publish history)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads publication log"
  ON public.publication_log FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. procurement_exceptions: compras SELECT (older exceptions table)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads procurement exceptions"
  ON public.procurement_exceptions FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. procurement_audit_log: compras SELECT (automation history)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads procurement audit log"
  ON public.procurement_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 17. holiday_calendars: compras SELECT (supplier calendar data)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads holiday calendars"
  ON public.holiday_calendars FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 18. matching_bindings: compras INSERT + UPDATE (create/revoke bindings)
--     (SELECT already granted in 0041)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras inserts matching bindings"
  ON public.matching_bindings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['compras']));

CREATE POLICY "compras updates matching bindings"
  ON public.matching_bindings FOR UPDATE
  TO authenticated
  USING (public.has_role(ARRAY['compras']))
  WITH CHECK (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 19. inventory_movements: compras SELECT (inventory history)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads inventory movements"
  ON public.inventory_movements FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 20. orchestrator_lease: compras ALL (run orchestrator)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras all orchestrator lease"
  ON public.orchestrator_lease FOR ALL
  TO authenticated
  USING (public.has_role(ARRAY['compras']))
  WITH CHECK (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 21. brands: compras SELECT + INSERT (create master from catalog item)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY "compras reads brands"
  ON public.brands FOR SELECT
  TO authenticated
  USING (public.has_role(ARRAY['compras']));

CREATE POLICY "compras inserts brands"
  ON public.brands FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(ARRAY['compras']));

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART B: RPC UPDATES — allow compras role alongside admin
--
-- All these RPCs are SECURITY DEFINER with internal is_admin() checks.
-- We recreate them changing is_admin() → has_role(ARRAY['compras'])
-- which allows both admin (always passes) and active compras users.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── B1: version_supplier_offer (from 0020) ──

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
  v_existing       record;
  v_new_id         uuid;
  v_unidade_compra text;
  v_qtd_emb        int;
  v_vende_avulso   boolean;
  v_unit_cost      int;
  v_operational    boolean;
  v_target_status  text;
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_cost_centavos <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido.');
  END IF;

  v_operational := public.is_supplier_operationally_active(p_supplier_id);
  v_target_status := CASE WHEN v_operational THEN 'ativa' ELSE 'pendente_condicoes' END;

  SELECT sci.unidade_compra, sci.qtd_por_embalagem, sci.vende_avulso
    INTO v_unidade_compra, v_qtd_emb, v_vende_avulso
    FROM supplier_catalog_items sci
   WHERE sci.id = p_catalog_item_id;

  v_unidade_compra := COALESCE(v_unidade_compra, 'unidade');
  v_qtd_emb := COALESCE(v_qtd_emb, 1);
  v_vende_avulso := COALESCE(v_vende_avulso, true);
  v_unit_cost := p_cost_centavos / GREATEST(v_qtd_emb, 1);

  SELECT id, cost_centavos, stock, lead_time_days, catalog_item_id,
         unidade_compra, qtd_por_embalagem, vende_avulso, status
    INTO v_existing
    FROM supplier_offers
   WHERE master_product_id = p_master_product_id
     AND supplier_id = p_supplier_id
     AND status IN ('ativa', 'pendente_condicoes')
     AND replaced_at IS NULL;

  IF v_existing IS NULL THEN
    INSERT INTO supplier_offers (
      master_product_id, supplier_id, catalog_item_id,
      cost_centavos, stock, lead_time_days, status,
      unidade_compra, qtd_por_embalagem, vende_avulso, unit_cost_centavos
    ) VALUES (
      p_master_product_id, p_supplier_id, p_catalog_item_id,
      p_cost_centavos, p_stock, p_lead_time_days, v_target_status,
      v_unidade_compra, v_qtd_emb, v_vende_avulso, v_unit_cost
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_new_id, 'action', 'created',
      'status', v_target_status
    );
  END IF;

  IF v_existing.cost_centavos = p_cost_centavos
     AND v_existing.stock IS NOT DISTINCT FROM p_stock
     AND v_existing.lead_time_days = p_lead_time_days
     AND v_existing.unidade_compra IS NOT DISTINCT FROM v_unidade_compra
     AND v_existing.qtd_por_embalagem IS NOT DISTINCT FROM v_qtd_emb
     AND v_existing.vende_avulso IS NOT DISTINCT FROM v_vende_avulso THEN

    IF v_existing.status != v_target_status THEN
      UPDATE supplier_offers SET status = v_target_status, updated_at = now()
      WHERE id = v_existing.id;
    END IF;

    IF v_existing.catalog_item_id IS DISTINCT FROM p_catalog_item_id THEN
      UPDATE supplier_offers SET catalog_item_id = p_catalog_item_id, updated_at = now()
      WHERE id = v_existing.id;
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'offer_id', v_existing.id, 'action', 'unchanged',
      'status', v_target_status
    );
  END IF;

  UPDATE supplier_offers SET replaced_at = now(), updated_at = now()
  WHERE id = v_existing.id;

  INSERT INTO supplier_offers (
    master_product_id, supplier_id, catalog_item_id,
    cost_centavos, stock, lead_time_days, status,
    unidade_compra, qtd_por_embalagem, vende_avulso, unit_cost_centavos
  ) VALUES (
    p_master_product_id, p_supplier_id, p_catalog_item_id,
    p_cost_centavos, p_stock, p_lead_time_days, v_target_status,
    v_unidade_compra, v_qtd_emb, v_vende_avulso, v_unit_cost
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'offer_id', v_new_id,
    'action', 'versioned',
    'status', v_target_status,
    'previous_offer_id', v_existing.id,
    'previous_cost', v_existing.cost_centavos,
    'previous_stock', v_existing.stock,
    'previous_lead_time', v_existing.lead_time_days
  );
END;
$$;

-- ── B2: revoke_matching_binding (from 0040) ──

CREATE OR REPLACE FUNCTION revoke_matching_binding(p_binding_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  UPDATE matching_bindings
  SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = p_reason
  WHERE id = p_binding_id AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vínculo não encontrado ou já revogado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── B3: undo_item_approval (from 0040) ──

CREATE OR REPLACE FUNCTION undo_item_approval(
  p_item_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_revoked_count int := 0;
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  SELECT id, supplier_id, supplier_sku, ean, master_product_id, match_status
  INTO v_item
  FROM supplier_catalog_items
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_item.match_status != 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não está aprovado');
  END IF;

  UPDATE matching_bindings
  SET revoked_at = now(),
      revoked_by = auth.uid(),
      revoked_reason = COALESCE(p_reason, 'Desfazer aprovação do item ' || p_item_id::text)
  WHERE master_product_id = v_item.master_product_id
    AND revoked_at IS NULL
    AND (
      (binding_type = 'supplier_sku' AND supplier_id = v_item.supplier_id AND supplier_sku = v_item.supplier_sku)
      OR (binding_type = 'ean' AND ean_clean = regexp_replace(COALESCE(v_item.ean, ''), '[\s\-./]', '', 'g'))
      OR (binding_type = 'normalized_name' AND supplier_id = v_item.supplier_id)
    );

  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  UPDATE supplier_catalog_items
  SET match_status = 'revisao_manual',
      master_product_id = NULL,
      match_confidence = NULL,
      match_signals = NULL
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'revoked_bindings', v_revoked_count
  );
END;
$$;

-- ── B4: restore_ignored_item (from 0040) ──

CREATE OR REPLACE FUNCTION restore_ignored_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  UPDATE supplier_catalog_items
  SET match_status = 'revisao_manual'
  WHERE id = p_item_id
    AND match_status = 'ignorado';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado ou não está ignorado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── B5: resolve_procurement_exception (from 0011) ──

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
  IF v_admin_id IS NULL OR NOT has_role(ARRAY['compras']) THEN
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

-- ── B6: acquire_orchestrator_lease (from 0011) ──

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
  IF NOT has_role(ARRAY['compras']) THEN
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

-- ── B7: release_orchestrator_lease (from 0011) ──

CREATE OR REPLACE FUNCTION public.release_orchestrator_lease(
  p_run_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
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

-- ── B8: renew_orchestrator_lease (from 0011) ──

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
  IF NOT has_role(ARRAY['compras']) THEN
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

-- ── B9: auto_switch_sourcing_safe (from 0027) ──
-- Drop old 9-param overload (from 0027) so only the 12-param version remains
DROP FUNCTION IF EXISTS public.auto_switch_sourcing_safe(uuid, uuid, text, numeric, jsonb, text, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.auto_switch_sourcing_safe(
  p_master_product_id          uuid,
  p_new_offer_id               uuid,
  p_note                       text,
  p_score                      numeric     DEFAULT NULL,
  p_ranking_snapshot           jsonb       DEFAULT NULL,
  p_reason                     text        DEFAULT 'auto_sourcing',
  p_expected_old_offer_id      uuid        DEFAULT NULL,
  p_expected_new_cost_centavos int         DEFAULT NULL,
  p_new_price_centavos         int         DEFAULT NULL,
  p_price_blocked              boolean     DEFAULT false,
  p_blocked_new_price_centavos int         DEFAULT NULL,
  p_blocked_change_pct         numeric     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auto_switch    boolean;
  v_new_offer      record;
  v_product        record;
  v_old_selection  record;
  v_selection_id   uuid;
  v_replacement_id uuid;
  v_old_price_centavos int;
  v_change_pct     numeric;
  v_limit_pct      numeric;
  v_price_log_id   uuid;
  v_price_updated  boolean := false;
  v_price_blocked  boolean := false;
  v_terms          record;
  v_exp_avail      date;
BEGIN
  IF NOT public.has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT (value)::boolean INTO v_auto_switch
    FROM ccm_configs WHERE key = 'auto_switch_enabled' AND scope = 'global' LIMIT 1;
  IF v_auto_switch IS NULL OR v_auto_switch = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auto_switch_enabled desativado.');
  END IF;

  SELECT * INTO v_new_offer FROM supplier_offers
   WHERE id = p_new_offer_id AND status = 'ativa' AND replaced_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Oferta não está mais ativa.');
  END IF;

  IF NOT public.is_supplier_operationally_active(v_new_offer.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor não está operacionalmente ativo.');
  END IF;

  IF v_new_offer.stock <= 0 OR v_new_offer.cost_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Oferta sem estoque ou custo zerado.');
  END IF;

  IF p_expected_new_cost_centavos IS NOT NULL
     AND v_new_offer.cost_centavos != p_expected_new_cost_centavos THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Custo mudou desde o cálculo.',
      'expected', p_expected_new_cost_centavos,
      'actual', v_new_offer.cost_centavos
    );
  END IF;

  SELECT id, supplier_offer_id
    INTO v_old_selection
    FROM sourcing_selections
   WHERE master_product_id = p_master_product_id AND replaced_at IS NULL
   FOR UPDATE;

  IF p_expected_old_offer_id IS NOT NULL
     AND v_old_selection IS NOT NULL
     AND v_old_selection.supplier_offer_id IS DISTINCT FROM p_expected_old_offer_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Seleção atual mudou.');
  END IF;

  IF v_old_selection IS NOT NULL AND v_old_selection.supplier_offer_id = p_new_offer_id THEN
    RETURN jsonb_build_object('ok', true, 'action', 'noop');
  END IF;

  SELECT * INTO v_product
    FROM products
   WHERE master_product_id = p_master_product_id::text
     AND active = true
   FOR UPDATE;

  IF v_product IS NOT NULL AND p_new_price_centavos IS NOT NULL THEN
    v_old_price_centavos := round(v_product.retail_price * 100)::int;

    IF p_new_price_centavos != v_old_price_centavos THEN
      v_change_pct := CASE
        WHEN v_old_price_centavos > 0 THEN
          ((p_new_price_centavos - v_old_price_centavos)::numeric / v_old_price_centavos) * 100
        ELSE 0
      END;

      SELECT sc.auto_price_increase_limit_pct
        INTO v_limit_pct
        FROM section_configs sc
       WHERE sc.section_slug = v_product.category_slug
       LIMIT 1;
      IF v_limit_pct IS NULL THEN v_limit_pct := 10; END IF;

      IF v_change_pct > 0 AND v_change_pct > v_limit_pct THEN
        v_price_blocked := true;
      END IF;
    END IF;
  END IF;

  IF p_price_blocked THEN
    v_price_blocked := true;
  END IF;

  v_exp_avail := NULL;
  SELECT * INTO v_terms
    FROM supplier_commercial_terms
   WHERE supplier_id = v_new_offer.supplier_id AND active = true AND valid_to IS NULL
   LIMIT 1;
  IF v_terms IS NOT NULL AND v_terms.dias_pedido IS NOT NULL THEN
    v_exp_avail := public.calculate_expected_availability(
      v_terms.dias_pedido,
      COALESCE(v_terms.prazo_entrega_cd_dias, 0),
      CURRENT_DATE,
      (now() AT TIME ZONE 'America/Sao_Paulo')::time
    );
  END IF;

  IF v_old_selection IS NOT NULL THEN
    UPDATE sourcing_selections SET replaced_at = now()
    WHERE id = v_old_selection.id;
  END IF;

  INSERT INTO sourcing_selections (
    master_product_id, supplier_offer_id, selected_by,
    note, score, ambiguous, ranking_snapshot
  ) VALUES (
    p_master_product_id, p_new_offer_id, auth.uid(),
    p_note, p_score, false, p_ranking_snapshot
  )
  RETURNING id INTO v_selection_id;

  INSERT INTO supplier_replacement_log (
    master_product_id, product_id,
    old_supplier_id, new_supplier_id,
    old_offer_id, new_offer_id,
    old_cost_centavos, new_cost_centavos,
    price_change_pct, reason, auto_applied
  ) VALUES (
    p_master_product_id,
    v_product.id,
    CASE WHEN v_old_selection IS NOT NULL THEN
      (SELECT supplier_id FROM supplier_offers WHERE id = v_old_selection.supplier_offer_id)
    ELSE NULL END,
    v_new_offer.supplier_id,
    v_old_selection.supplier_offer_id,
    p_new_offer_id,
    CASE WHEN v_old_selection IS NOT NULL THEN
      (SELECT unit_cost_centavos FROM supplier_offers WHERE id = v_old_selection.supplier_offer_id)
    ELSE NULL END,
    v_new_offer.unit_cost_centavos,
    v_change_pct,
    p_reason, true
  )
  RETURNING id INTO v_replacement_id;

  IF v_product IS NOT NULL AND NOT v_price_blocked
     AND p_new_price_centavos IS NOT NULL
     AND p_new_price_centavos != round(v_product.retail_price * 100)::int THEN
    UPDATE products
       SET retail_price = p_new_price_centavos / 100.0,
           cost_centavos = v_new_offer.cost_centavos,
           supplier_id = v_new_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_selection_id,
           expected_availability_date = v_exp_avail,
           updated_at = now()
     WHERE id = v_product.id;

    INSERT INTO price_change_log (
      product_id, master_product_id, supplier_id,
      old_cost_centavos, new_cost_centavos,
      old_price_centavos, new_price_centavos,
      change_pct, auto_applied, blocked
    ) VALUES (
      v_product.id, p_master_product_id, v_new_offer.supplier_id,
      v_product.cost_centavos, v_new_offer.cost_centavos,
      round(v_product.retail_price * 100)::int, p_new_price_centavos,
      v_change_pct, true, false
    )
    RETURNING id INTO v_price_log_id;
    v_price_updated := true;

  ELSIF v_product IS NOT NULL AND v_price_blocked THEN
    UPDATE products
       SET cost_centavos = v_new_offer.cost_centavos,
           supplier_id = v_new_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_selection_id,
           expected_availability_date = v_exp_avail,
           updated_at = now()
     WHERE id = v_product.id;

    INSERT INTO price_change_log (
      product_id, master_product_id, supplier_id,
      old_cost_centavos, new_cost_centavos,
      old_price_centavos, new_price_centavos,
      change_pct, auto_applied, blocked
    ) VALUES (
      v_product.id, p_master_product_id, v_new_offer.supplier_id,
      v_product.cost_centavos, v_new_offer.cost_centavos,
      round(v_product.retail_price * 100)::int,
      COALESCE(p_blocked_new_price_centavos, p_new_price_centavos),
      COALESCE(p_blocked_change_pct, v_change_pct),
      false, true
    )
    RETURNING id INTO v_price_log_id;

  ELSIF v_product IS NOT NULL THEN
    UPDATE products
       SET cost_centavos = v_new_offer.cost_centavos,
           supplier_id = v_new_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_selection_id,
           expected_availability_date = v_exp_avail,
           updated_at = now()
     WHERE id = v_product.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', CASE WHEN v_old_selection IS NOT NULL THEN 'switched' ELSE 'selected' END,
    'selection_id', v_selection_id,
    'replacement_log_id', v_replacement_id,
    'price_log_id', v_price_log_id,
    'price_updated', v_price_updated,
    'price_blocked', v_price_blocked,
    'old_supplier_id', CASE WHEN v_old_selection IS NOT NULL THEN
      (SELECT supplier_id FROM supplier_offers WHERE id = v_old_selection.supplier_offer_id)
    ELSE NULL END,
    'new_supplier_id', v_new_offer.supplier_id,
    'change_pct', v_change_pct,
    'expected_availability_date', v_exp_avail
  );
END;
$$;

-- ── B10: consolidate_cycle_purchase_orders (from 0029) ──

CREATE OR REPLACE FUNCTION public.consolidate_cycle_purchase_orders(
  p_cycle_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id    uuid;
  v_supplier_id text;
  v_result      jsonb;
  v_generated   int := 0;
  v_skipped     int := 0;
  v_errors      int := 0;
  v_details     jsonb := '[]'::jsonb;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  FOR v_supplier_id IN
    SELECT DISTINCT pr.supplier_id
    FROM public.purchase_requirements pr
    WHERE pr.cycle_date = p_cycle_date
      AND pr.status = 'pending'
    ORDER BY pr.supplier_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.supplier_purchase_orders
      WHERE supplier_id = v_supplier_id
        AND cycle_date = p_cycle_date
        AND status NOT IN ('cancelled')
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_result := public.generate_purchase_order(v_supplier_id, p_cycle_date);

    IF (v_result->>'ok')::boolean THEN
      v_generated := v_generated + 1;
      v_details := v_details || jsonb_build_object(
        'supplier_id', v_supplier_id,
        'purchase_order_id', v_result->>'purchase_order_id',
        'total_centavos', (v_result->>'total_centavos')::int,
        'minimum_met', (v_result->>'minimum_met')::boolean
      );
    ELSE
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'generated', v_generated,
    'skipped', v_skipped,
    'errors', v_errors,
    'details', v_details
  );
END;
$$;
