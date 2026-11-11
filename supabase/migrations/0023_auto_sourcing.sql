-- ============================================================================
-- CCM · Migration 0023 — Auto-sourcing: RPC transacional segura
-- ============================================================================
--
-- Cria RPC auto_switch_sourcing_safe que executa troca de fornecedor de forma
-- atômica e segura, com guards anti-TOCTOU, locking transacional e validação
-- de pricing dentro da mesma transação.
--
-- Guards:
--   1. is_admin() — SECURITY DEFINER, selected_by = auth.uid()
--   2. auto_switch_enabled flag lida dentro da transação
--   3. Offer nova: ativa, não replaced, stock > 0, cost > 0, supplier operacional
--   4. Cost não mudou desde o cálculo de pricing (p_expected_new_cost_centavos)
--   5. Sourcing atual é o esperado (p_expected_old_offer_id)
--   6. Se produto publicado: pricing dentro de auto_price_increase_limit_pct
--   7. Se produto publicado e preço muda: auto_price_enabled = true
--   8. SELECT ... FOR UPDATE em offer, sourcing, produto para evitar concorrência
--
-- Retorna jsonb com { ok, error?, selection_id?, ... }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_switch_sourcing_safe(
  p_master_product_id          uuid,
  p_new_offer_id               uuid,
  p_note                       text,
  p_score                      numeric     DEFAULT NULL,
  p_ranking_snapshot           jsonb       DEFAULT NULL,
  p_reason                     text        DEFAULT 'auto_sourcing',
  p_expected_old_offer_id      uuid        DEFAULT NULL,
  p_expected_new_cost_centavos int         DEFAULT NULL,
  p_new_price_centavos         int         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id             uuid;
  v_auto_switch          boolean;
  v_auto_price           boolean;
  v_offer                record;
  v_old_sel              record;
  v_new_sel_id           uuid;
  v_product              record;
  v_old_price_centavos   int;
  v_new_price_centavos   int;
  v_change_pct           numeric(8,2);
  v_limit_pct            numeric(5,2);
  v_repl_id              uuid;
  v_price_log_id         uuid;
  v_price_updated        boolean := false;
BEGIN
  -- =========================================================================
  -- GUARD 1: Autorização
  -- =========================================================================
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador.';
  END IF;
  v_admin_id := auth.uid();

  -- =========================================================================
  -- GUARD 2: Flag auto_switch_enabled (lida dentro da transação)
  -- =========================================================================
  SELECT (value)::boolean INTO v_auto_switch
    FROM ccm_configs
   WHERE key = 'auto_switch_enabled' AND scope = 'global'
   LIMIT 1;

  IF v_auto_switch IS NULL OR v_auto_switch = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'auto_switch_enabled esta desativado.'
    );
  END IF;

  -- =========================================================================
  -- GUARD 3: Offer nova — lock + validação completa
  -- =========================================================================
  SELECT id, master_product_id, supplier_id, status, stock,
         cost_centavos, replaced_at, lead_time_days
    INTO v_offer
    FROM supplier_offers
   WHERE id = p_new_offer_id
     AND master_product_id = p_master_product_id
   FOR UPDATE;

  IF v_offer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Offer nao encontrada.');
  END IF;

  IF v_offer.status != 'ativa' OR v_offer.replaced_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Offer nao esta ativa ou foi substituida.');
  END IF;

  IF v_offer.stock IS NULL OR v_offer.stock <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Offer sem estoque.');
  END IF;

  IF v_offer.cost_centavos IS NULL OR v_offer.cost_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Offer com custo invalido.');
  END IF;

  IF NOT is_supplier_operationally_active(v_offer.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor nao operacional.');
  END IF;

  -- =========================================================================
  -- GUARD 4: Custo não mudou desde o cálculo de pricing no TS
  -- =========================================================================
  IF p_expected_new_cost_centavos IS NOT NULL
     AND v_offer.cost_centavos != p_expected_new_cost_centavos THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Custo da offer mudou (esperado: %s, atual: %s). Recalcular pricing.',
                       p_expected_new_cost_centavos, v_offer.cost_centavos)
    );
  END IF;

  -- =========================================================================
  -- GUARD 5: Sourcing atual é o esperado (anti-TOCTOU)
  -- =========================================================================
  SELECT id, supplier_offer_id, replaced_at
    INTO v_old_sel
    FROM sourcing_selections
   WHERE master_product_id = p_master_product_id
     AND replaced_at IS NULL
   FOR UPDATE;

  -- Se esperávamos um offer_id antigo específico, verificar
  IF p_expected_old_offer_id IS NOT NULL AND v_old_sel.supplier_offer_id IS DISTINCT FROM p_expected_old_offer_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Sourcing atual mudou desde o pre-check.'
    );
  END IF;

  -- Se já aponta para a mesma offer, noop
  IF v_old_sel.supplier_offer_id = p_new_offer_id THEN
    RETURN jsonb_build_object('ok', true, 'action', 'noop');
  END IF;

  -- =========================================================================
  -- GUARD 6 + 7: Pricing do produto publicado
  -- =========================================================================
  SELECT p.id, p.retail_price, p.cost_centavos, p.category_slug, p.supplier_id,
         p.winning_offer_id, p.master_product_id
    INTO v_product
    FROM products p
   WHERE p.master_product_id = p_master_product_id
     AND p.publish_status = 'publicada'
     AND p.active = true
   FOR UPDATE;

  IF v_product.id IS NOT NULL THEN
    -- Produto publicado existe — validar pricing
    v_old_price_centavos := ROUND(v_product.retail_price * 100)::int;
    v_new_price_centavos := COALESCE(p_new_price_centavos, v_old_price_centavos);

    IF v_new_price_centavos != v_old_price_centavos THEN
      -- Preço vai mudar — verificar auto_price_enabled (Guard 7)
      SELECT (value)::boolean INTO v_auto_price
        FROM ccm_configs
       WHERE key = 'auto_price_enabled' AND scope = 'global'
       LIMIT 1;

      IF v_auto_price IS NULL OR v_auto_price = false THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'auto_price_enabled desativado e troca exige mudanca de preco.'
        );
      END IF;

      -- Verificar limite de variação (Guard 6)
      v_change_pct := CASE
        WHEN v_old_price_centavos > 0 THEN
          ((v_new_price_centavos - v_old_price_centavos)::numeric / v_old_price_centavos) * 100
        ELSE 0
      END;

      SELECT COALESCE((sc.value)::numeric, 10)
        INTO v_limit_pct
        FROM section_configs sc
       WHERE sc.section = v_product.category_slug
         AND sc.key = 'auto_price_increase_limit_pct'
       LIMIT 1;

      IF v_limit_pct IS NULL THEN v_limit_pct := 10; END IF;

      -- Aumentos acima do limite → bloquear
      IF v_change_pct > v_limit_pct THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'Variacao de preco ' || round(v_change_pct, 2) || '%% excede limite ' || round(v_limit_pct, 2) || '%%.',
          'change_pct', v_change_pct,
          'limit_pct', v_limit_pct
        );
      END IF;
    END IF;
  END IF;

  -- =========================================================================
  -- MUTAÇÕES — todos os guards passaram
  -- =========================================================================

  -- M1: Encerrar sourcing anterior
  IF v_old_sel.id IS NOT NULL THEN
    UPDATE sourcing_selections
       SET replaced_at = now()
     WHERE id = v_old_sel.id;
  END IF;

  -- M2: Criar novo sourcing
  INSERT INTO sourcing_selections (
    master_product_id, supplier_offer_id, selected_by,
    note, score, ambiguous, ranking_snapshot
  ) VALUES (
    p_master_product_id, p_new_offer_id, v_admin_id,
    p_note, p_score, false, p_ranking_snapshot
  ) RETURNING id INTO v_new_sel_id;

  -- M3: Log de troca de fornecedor
  INSERT INTO supplier_replacement_log (
    master_product_id,
    product_id,
    old_supplier_id,
    new_supplier_id,
    old_offer_id,
    new_offer_id,
    reason,
    old_cost_centavos,
    new_cost_centavos,
    price_change_pct,
    auto_applied
  ) VALUES (
    p_master_product_id,
    v_product.id,
    CASE WHEN v_old_sel.id IS NOT NULL THEN
      (SELECT supplier_id FROM supplier_offers WHERE id = v_old_sel.supplier_offer_id)
    ELSE NULL END,
    v_offer.supplier_id,
    v_old_sel.supplier_offer_id,
    p_new_offer_id,
    p_reason,
    v_product.cost_centavos,
    v_offer.cost_centavos,
    CASE WHEN v_product.id IS NOT NULL AND v_old_price_centavos > 0
         THEN v_change_pct ELSE NULL END,
    true
  ) RETURNING id INTO v_repl_id;

  -- M4: Atualizar preço do produto publicado (se aplicável)
  IF v_product.id IS NOT NULL
     AND v_new_price_centavos IS NOT NULL
     AND v_new_price_centavos != v_old_price_centavos THEN

    UPDATE products
       SET retail_price   = v_new_price_centavos / 100.0,
           cost_centavos  = v_offer.cost_centavos,
           supplier_id    = v_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_new_sel_id,
           updated_at     = now()
     WHERE id = v_product.id;

    INSERT INTO price_change_log (
      product_id, master_product_id, supplier_id,
      old_cost_centavos, new_cost_centavos,
      old_price_centavos, new_price_centavos,
      change_pct, auto_applied, blocked
    ) VALUES (
      v_product.id, p_master_product_id, v_offer.supplier_id,
      v_product.cost_centavos, v_offer.cost_centavos,
      v_old_price_centavos, v_new_price_centavos,
      v_change_pct, true, false
    ) RETURNING id INTO v_price_log_id;

    v_price_updated := true;

  ELSIF v_product.id IS NOT NULL AND v_new_price_centavos = v_old_price_centavos THEN
    -- Preço não muda, mas atualizar supplier/offer/cost do produto
    UPDATE products
       SET cost_centavos  = v_offer.cost_centavos,
           supplier_id    = v_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_new_sel_id,
           updated_at     = now()
     WHERE id = v_product.id;
  END IF;

  -- =========================================================================
  -- RETORNO
  -- =========================================================================
  RETURN jsonb_build_object(
    'ok', true,
    'action', CASE WHEN v_old_sel.id IS NOT NULL THEN 'switched' ELSE 'selected' END,
    'selection_id', v_new_sel_id,
    'replacement_log_id', v_repl_id,
    'price_log_id', v_price_log_id,
    'price_updated', v_price_updated,
    'old_supplier_id', CASE WHEN v_old_sel.id IS NOT NULL THEN
      (SELECT supplier_id FROM supplier_offers WHERE id = v_old_sel.supplier_offer_id)
    ELSE NULL END,
    'new_supplier_id', v_offer.supplier_id,
    'change_pct', v_change_pct
  );
END;
$$;

-- ============================================================================
-- Permissões
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.auto_switch_sourcing_safe FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_switch_sourcing_safe FROM anon;
GRANT  EXECUTE ON FUNCTION public.auto_switch_sourcing_safe TO authenticated;
