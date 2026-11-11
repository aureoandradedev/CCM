-- ============================================================================
-- 0020_supplier_operational_guards.sql
-- ============================================================================
-- Corrige a brecha: fornecedores sem condições comerciais ativas NÃO podem
-- participar de ranking, sourcing, publicação nem gerar pedido de compra.
--
-- Regra central: is_supplier_operationally_active(supplier_id) = true
--   ↳ Definida em 0016, verifica supplier_commercial_terms com
--      active=true, valid_to IS NULL, pedido_minimo_tipo='valor'.
--
-- Mudanças:
--   1. Novo status 'pendente_condicoes' em supplier_offers
--   2. version_supplier_offer → cria offer com 'pendente_condicoes' se supplier não operacional
--   3. select_sourcing_offer → rejeita offer de supplier não operacional
--   4. publish_product → rejeita publicação de supplier não operacional
--   5. generate_purchase_order → usa is_supplier_operationally_active
--   6. promote_pending_offers() → ativa offers pendentes quando supplier fica operacional
--   7. propose_commercial_terms() → fornecedor propõe seus terms (RLS: owns_supplier)
-- ============================================================================

-- ============================================================================
-- 1. NOVO STATUS: 'pendente_condicoes' em supplier_offers
-- ============================================================================
-- A CHECK constraint atual (0005) é:
--   check (status in ('ativa','indisponivel','vencida','escolhida'))
-- Precisamos adicionar 'pendente_condicoes'.

ALTER TABLE public.supplier_offers
  DROP CONSTRAINT IF EXISTS supplier_offers_status_check;

ALTER TABLE public.supplier_offers
  ADD CONSTRAINT supplier_offers_status_check
  CHECK (status IN ('ativa', 'indisponivel', 'vencida', 'escolhida', 'pendente_condicoes'));

-- ============================================================================
-- 2. version_supplier_offer — agora verifica status operacional
-- ============================================================================
-- Se supplier NÃO é operacionalmente ativo:
--   - Cria offer com status 'pendente_condicoes' em vez de 'ativa'
--   - Permite que o catálogo seja importado/processado normalmente
--   - Offer NÃO entra no ranking (ELIGIBLE_STATUSES = {'ativa'})

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
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_cost_centavos <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido.');
  END IF;

  -- Verificar status operacional do fornecedor
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

  -- Buscar offer existente (ativa OU pendente_condicoes)
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

  -- Se offer existente é pendente_condicoes e supplier agora é operacional, promover
  -- Se offer existente é ativa e supplier deixou de ser operacional, rebaixar
  -- Caso contrário, manter o status alvo
  IF v_existing.cost_centavos = p_cost_centavos
     AND v_existing.stock IS NOT DISTINCT FROM p_stock
     AND v_existing.lead_time_days = p_lead_time_days
     AND v_existing.unidade_compra IS NOT DISTINCT FROM v_unidade_compra
     AND v_existing.qtd_por_embalagem IS NOT DISTINCT FROM v_qtd_emb
     AND v_existing.vende_avulso IS NOT DISTINCT FROM v_vende_avulso THEN

    -- Dados iguais, mas status pode ter mudado
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

  -- Dados mudaram: versionar
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

-- ============================================================================
-- 3. select_sourcing_offer — rejeita supplier não operacional
-- ============================================================================

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
  v_id          uuid;
  v_offer       record;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador.';
  END IF;

  SELECT id, master_product_id, supplier_id, status
    INTO v_offer
    FROM supplier_offers
   WHERE id = p_supplier_offer_id
     AND master_product_id = p_master_product_id
     AND status = 'ativa';

  IF v_offer IS NULL THEN
    RAISE EXCEPTION 'Oferta não encontrada ou não está ativa.';
  END IF;

  -- GUARD: supplier deve ser operacionalmente ativo
  IF NOT public.is_supplier_operationally_active(v_offer.supplier_id) THEN
    RAISE EXCEPTION 'Fornecedor sem condições comerciais ativas. Não é possível selecionar esta oferta.';
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

-- ============================================================================
-- 4. publish_product — adiciona guard de supplier operacional
-- ============================================================================
-- Reproduz fielmente a função original de 0009_publish.sql.
-- ÚNICA adição: guard is_supplier_operationally_active após passo 4.

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
  -- 1. Admin check
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  -- 2. Load master product
  SELECT * INTO v_mp FROM master_products WHERE id = p_master_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Produto mestre nao encontrado.');
  END IF;
  IF v_mp.name IS NULL OR v_mp.name = '' THEN
    RETURN jsonb_build_object('error', 'Produto mestre sem nome.');
  END IF;

  -- 3. Verify selection unchanged
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

  -- 4. Load offer, validate active + current version
  SELECT * INTO v_offer FROM supplier_offers WHERE id = v_sel.supplier_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Oferta selecionada nao encontrada.');
  END IF;
  IF v_offer.status != 'ativa' THEN
    RETURN jsonb_build_object('error', format('Oferta com status %L (esperado: ativa).', v_offer.status));
  END IF;

  -- 4b. GUARD: supplier deve ser operacionalmente ativo (0020)
  IF NOT public.is_supplier_operationally_active(v_offer.supplier_id) THEN
    RETURN jsonb_build_object('error', 'Fornecedor sem condições comerciais ativas. Não é possível publicar.');
  END IF;

  v_cost := v_offer.cost_centavos;
  IF v_cost <= 0 THEN
    RETURN jsonb_build_object('error', 'Custo invalido (zero ou negativo).');
  END IF;
  v_offer_stock := v_offer.stock;

  -- 5. Cost staleness check
  IF v_cost != p_expected_cost_centavos THEN
    RETURN jsonb_build_object('error',
      format('Custo da oferta mudou desde o preview (esperado: %s, atual: %s). Revise antes de publicar.',
        p_expected_cost_centavos, v_cost));
  END IF;

  -- 6. Load existing product
  SELECT id, winning_offer_id, stock
    INTO v_existing_id, v_existing_offer_id, v_existing_stock
    FROM products
   WHERE master_product_id = p_master_product_id
     AND publish_status IN ('publicada','rascunho','aguardando_aprovacao');

  v_is_republish := v_existing_id IS NOT NULL;
  v_same_offer := v_is_republish AND v_existing_offer_id = v_offer.id;
  v_final_product_id := COALESCE(v_existing_id, p_product_id);

  -- 7. Stock behavior
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

  -- 8. Resolve margin rule (product > category > global)
  v_resolved_rule_id := NULL;

  SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
    FROM margin_rules
   WHERE active = true AND scope = 'product'
     AND scope_ref = p_master_product_id::text
   ORDER BY priority DESC LIMIT 1;

  IF v_resolved_rule_id IS NOT NULL THEN
    SELECT count(*) INTO v_tie_count FROM margin_rules
     WHERE active = true AND scope = 'product'
       AND scope_ref = p_master_product_id::text AND priority = v_resolved_priority;
    IF v_tie_count > 1 THEN
      RETURN jsonb_build_object('error',
        format('Margem ambigua: %s regras empatadas no escopo produto (prioridade %s).', v_tie_count, v_resolved_priority));
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL AND v_mp.category_slug IS NOT NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules
     WHERE active = true AND scope = 'category' AND scope_ref = v_mp.category_slug
     ORDER BY priority DESC LIMIT 1;
    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count FROM margin_rules
       WHERE active = true AND scope = 'category'
         AND scope_ref = v_mp.category_slug AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo categoria (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL THEN
    SELECT id, priority INTO v_resolved_rule_id, v_resolved_priority
      FROM margin_rules WHERE active = true AND scope = 'global'
     ORDER BY priority DESC LIMIT 1;
    IF v_resolved_rule_id IS NOT NULL THEN
      SELECT count(*) INTO v_tie_count FROM margin_rules
       WHERE active = true AND scope = 'global' AND priority = v_resolved_priority;
      IF v_tie_count > 1 THEN
        RETURN jsonb_build_object('error',
          format('Margem ambigua: %s regras empatadas no escopo global (prioridade %s).', v_tie_count, v_resolved_priority));
      END IF;
    END IF;
  END IF;

  IF v_resolved_rule_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Nenhuma regra de margem aplicavel.');
  END IF;

  -- 9. Compare resolved margin with expected
  IF v_resolved_rule_id != p_margin_rule_id THEN
    RETURN jsonb_build_object('error', 'Regra de margem vencedora mudou desde o preview. Revise antes de publicar.');
  END IF;

  -- 10. Load rule, calculate price
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
    IF v_rounded_price < v_raw_price THEN v_rounded_price := v_rounded_price + 100; END IF;
  ELSIF v_rounding = 'X99' THEN
    v_rounded_price := (v_raw_price / 100) * 100 + 99;
    IF v_rounded_price < v_raw_price THEN v_rounded_price := v_rounded_price + 100; END IF;
  END IF;

  IF v_rounded_price < v_cost THEN v_rounded_price := v_cost; END IF;
  IF v_min_price IS NOT NULL AND v_rounded_price < v_min_price THEN v_rounded_price := v_min_price; END IF;

  v_retail_price := v_rounded_price / 100.0;

  -- 11. Price staleness check
  IF v_rounded_price != p_expected_retail_centavos THEN
    RETURN jsonb_build_object('error',
      format('Preco calculado difere do revisado (esperado: %s ctv, calculado: %s ctv). Parametros da regra podem ter mudado. Revise antes de publicar.',
        p_expected_retail_centavos, v_rounded_price));
  END IF;

  -- 12. Stock status
  IF v_stock IS NOT NULL AND v_stock > 0 THEN v_stock_status := 'in_stock';
  ELSIF v_stock IS NULL THEN v_stock_status := 'supplier';
  ELSE v_stock_status := 'out';
  END IF;

  -- 13. Upsert product
  IF v_is_republish THEN
    UPDATE products SET
      slug = p_product_slug, sku = p_product_sku, ean = v_mp.ean,
      name = v_mp.name, brand_slug = v_mp.brand_slug,
      brand_name = COALESCE(v_mp.brand_name, ''),
      category_slug = v_mp.category_slug, subcategory_slug = v_mp.subcategory_slug,
      supplier_id = v_offer.supplier_id, unit = COALESCE(v_mp.unit, 'un'),
      pack_info = v_mp.pack_info, retail_price = v_retail_price,
      description = v_mp.description,
      short_description = COALESCE(left(v_mp.description, 200), v_mp.name),
      specs = COALESCE(v_mp.specs, '[]'::jsonb),
      images = COALESCE(v_mp.images, '{}'::text[]),
      tags = COALESCE(v_mp.tags, '{}'::text[]),
      stock = v_stock, stock_status = v_stock_status,
      master_product_id = p_master_product_id, winning_offer_id = v_offer.id,
      cost_centavos = v_cost, margin_pct = v_margin_pct,
      publish_status = 'publicada', sourcing_selection_id = v_sel.id,
      offer_approved_by = v_admin_id, offer_approved_at = now(),
      offer_approval_note = p_note, offer_score = NULL,
      active = true, updated_at = now()
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

  -- 14. Insert audit log
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
-- 5. generate_purchase_order — usar is_supplier_operationally_active
-- ============================================================================
-- Adiciona guard centralizado ANTES do SELECT direto existente.
-- O restante da função permanece idêntico ao original (0018).

CREATE OR REPLACE FUNCTION public.generate_purchase_order(
  p_supplier_id  text,
  p_cycle_date   date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id   uuid;
  v_terms      record;
  v_po_id      uuid;
  v_subtotal   bigint := 0;
  v_freight    int := 0;
  v_count      int := 0;
  v_min_met    boolean;
  v_req        record;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- GUARD: função centralizada (0020)
  IF NOT public.is_supplier_operationally_active(p_supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor sem condições comerciais ativas.');
  END IF;

  -- Condições comerciais ativas (0016) — carrega os dados para montar o PO
  SELECT * INTO v_terms
  FROM public.supplier_commercial_terms
  WHERE supplier_id = p_supplier_id AND active = true AND valid_to IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor sem condições comerciais ativas.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_orders
    WHERE supplier_id = p_supplier_id AND cycle_date = p_cycle_date
      AND status NOT IN ('cancelled')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe pedido de compra para este ciclo.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_requirements
    WHERE supplier_id = p_supplier_id AND cycle_date = p_cycle_date AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma necessidade de compra pendente para este ciclo.');
  END IF;

  INSERT INTO public.supplier_purchase_orders (
    supplier_id, cycle_date, status, created_by,
    freight_type, freight_free_above, freight_value,
    minimum_type, minimum_value
  ) VALUES (
    p_supplier_id, p_cycle_date, 'draft', v_admin_id,
    v_terms.frete_tipo, v_terms.frete_gratis_acima, v_terms.frete_valor,
    v_terms.pedido_minimo_tipo, v_terms.pedido_minimo
  )
  RETURNING id INTO v_po_id;

  FOR v_req IN
    SELECT
      pr.master_product_id,
      SUM(pr.quantity_units) AS total_qty,
      MAX(pr.qtd_por_embalagem) AS emb,
      MAX(pr.unidade_compra) AS unidade,
      MAX(pr.unit_cost_centavos) AS unit_cost,
      MAX(pr.pack_cost_centavos) AS pack_cost,
      MAX(mp.name) AS product_name
    FROM public.purchase_requirements pr
    JOIN public.master_products mp ON mp.id = pr.master_product_id
    WHERE pr.supplier_id = p_supplier_id
      AND pr.cycle_date = p_cycle_date
      AND pr.status = 'pending'
    GROUP BY pr.master_product_id
  LOOP
    DECLARE
      v_emb int;
      v_pack_count int;
      v_actual_units int;
      v_leftover int;
      v_line_total int;
    BEGIN
      v_emb := GREATEST(COALESCE(v_req.emb, 1), 1);

      IF v_emb > 1 THEN
        v_pack_count := CEIL(v_req.total_qty::numeric / v_emb);
        v_actual_units := v_pack_count * v_emb;
        v_leftover := v_actual_units - v_req.total_qty;
      ELSE
        v_pack_count := v_req.total_qty;
        v_actual_units := v_req.total_qty;
        v_leftover := 0;
      END IF;

      IF v_req.pack_cost IS NOT NULL AND v_emb > 1 THEN
        v_line_total := v_pack_count * v_req.pack_cost;
      ELSE
        v_line_total := v_actual_units * COALESCE(v_req.unit_cost, 0);
      END IF;

      INSERT INTO public.purchase_order_items (
        purchase_order_id, master_product_id, product_name,
        quantity_units, pack_count, qtd_por_embalagem, unidade_compra,
        unit_cost_centavos, pack_cost_centavos, subtotal_centavos,
        leftover_units
      ) VALUES (
        v_po_id, v_req.master_product_id, v_req.product_name,
        v_actual_units, v_pack_count, v_emb, COALESCE(v_req.unidade, 'unidade'),
        COALESCE(v_req.unit_cost, 0), v_req.pack_cost, v_line_total,
        v_leftover
      );

      v_subtotal := v_subtotal + v_line_total;
      v_count := v_count + 1;
    END;
  END LOOP;

  -- Frete (lógica original 0018)
  IF v_terms.frete_tipo = 'fixo' THEN
    v_freight := COALESCE((v_terms.frete_valor * 100)::int, 0);
  ELSIF v_terms.frete_tipo = 'gratis_acima' THEN
    IF v_subtotal >= COALESCE((v_terms.frete_gratis_acima * 100)::bigint, 0) THEN
      v_freight := 0;
    ELSE
      v_freight := COALESCE((v_terms.frete_valor * 100)::int, 0);
    END IF;
  END IF;

  -- Pedido mínimo (R4.3)
  IF v_terms.pedido_minimo_tipo = 'valor' AND v_terms.pedido_minimo IS NOT NULL THEN
    v_min_met := v_subtotal >= (v_terms.pedido_minimo * 100)::bigint;
  ELSE
    v_min_met := true;
  END IF;

  UPDATE public.supplier_purchase_orders SET
    subtotal_centavos = v_subtotal,
    freight_centavos = v_freight,
    total_centavos = v_subtotal + v_freight,
    item_count = v_count,
    minimum_met = v_min_met,
    status = CASE WHEN v_min_met THEN 'ready' ELSE 'minimum_not_met' END,
    expected_delivery = public.add_business_days(
      p_cycle_date, COALESCE(v_terms.prazo_entrega_cd_dias, 0)
    )
  WHERE id = v_po_id;

  -- Vincular requirements
  UPDATE public.purchase_requirements
  SET status = 'included', purchase_order_id = v_po_id
  WHERE supplier_id = p_supplier_id AND cycle_date = p_cycle_date AND status = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_order_id', v_po_id,
    'subtotal_centavos', v_subtotal,
    'freight_centavos', v_freight,
    'total_centavos', v_subtotal + v_freight,
    'item_count', v_count,
    'minimum_met', v_min_met
  );
END;
$$;

-- ============================================================================
-- 6. promote_pending_offers — promove offers quando supplier fica operacional
-- ============================================================================
-- Chamada pelo admin (ou trigger) quando condições comerciais são ativadas.
-- Converte todas as offers 'pendente_condicoes' do supplier para 'ativa'.

CREATE OR REPLACE FUNCTION public.promote_pending_offers(p_supplier_id text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.is_supplier_operationally_active(p_supplier_id) THEN
    RETURN 0;
  END IF;

  UPDATE supplier_offers
  SET status = 'ativa', updated_at = now()
  WHERE supplier_id = p_supplier_id
    AND status = 'pendente_condicoes'
    AND replaced_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Trigger: ao inserir/atualizar supplier_commercial_terms com active=true,
-- promover automaticamente as offers pendentes.
CREATE OR REPLACE FUNCTION public.trg_promote_offers_on_terms()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.active = true AND NEW.valid_to IS NULL THEN
    PERFORM public.promote_pending_offers(NEW.supplier_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promote_offers_on_terms ON public.supplier_commercial_terms;
CREATE TRIGGER promote_offers_on_terms
  AFTER INSERT OR UPDATE ON public.supplier_commercial_terms
  FOR EACH ROW EXECUTE FUNCTION public.trg_promote_offers_on_terms();

-- ============================================================================
-- 7. propose_commercial_terms — fornecedor propõe condições comerciais
-- ============================================================================
-- O próprio fornecedor pode propor seus termos (inseridos como active=false,
-- aguardando aprovação do admin). Usa RLS via owns_supplier internamente.

CREATE OR REPLACE FUNCTION public.propose_commercial_terms(
  p_supplier_id             text,
  p_pedido_minimo_tipo      text,
  p_pedido_minimo           int,
  p_frete_tipo              text,
  p_frete_gratis_acima      int DEFAULT NULL,
  p_frete_valor             int DEFAULT NULL,
  p_dias_pedido             int[] DEFAULT ARRAY[1,2,3,4,5],
  p_prazo_entrega_cd_dias   int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Verificar que o chamador é dono do supplier OU admin
  IF NOT public.owns_supplier(p_supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- Validações básicas
  IF p_pedido_minimo_tipo NOT IN ('valor', 'volume') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de pedido mínimo inválido.');
  END IF;
  IF p_pedido_minimo IS NULL OR p_pedido_minimo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido mínimo deve ser maior que zero.');
  END IF;
  IF p_frete_tipo NOT IN ('fixo', 'gratis_acima') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de frete inválido.');
  END IF;
  IF p_frete_tipo = 'fixo' AND (p_frete_valor IS NULL OR p_frete_valor < 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor do frete fixo inválido.');
  END IF;
  IF p_frete_tipo = 'gratis_acima' AND (p_frete_gratis_acima IS NULL OR p_frete_gratis_acima <= 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor mínimo para frete grátis inválido.');
  END IF;
  IF p_dias_pedido IS NULL OR array_length(p_dias_pedido, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe ao menos um dia de pedido.');
  END IF;
  IF p_prazo_entrega_cd_dias IS NULL OR p_prazo_entrega_cd_dias < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Prazo de entrega deve ser ao menos 1 dia.');
  END IF;

  -- Se admin está chamando, inserir como active=true diretamente
  -- Se fornecedor está chamando, inserir como active=false (proposta)
  IF public.is_admin() THEN
    -- Desativar terms anteriores
    UPDATE supplier_commercial_terms
    SET active = false, valid_to = now()
    WHERE supplier_id = p_supplier_id AND active = true AND valid_to IS NULL;

    INSERT INTO supplier_commercial_terms (
      supplier_id, pedido_minimo_tipo, pedido_minimo,
      frete_tipo, frete_gratis_acima, frete_valor,
      dias_pedido, prazo_entrega_cd_dias, active
    ) VALUES (
      p_supplier_id, p_pedido_minimo_tipo, p_pedido_minimo,
      p_frete_tipo, p_frete_gratis_acima, p_frete_valor,
      p_dias_pedido, p_prazo_entrega_cd_dias, true
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'terms_id', v_id, 'status', 'ativo');
  ELSE
    -- Fornecedor: proposta pendente (active=false)
    INSERT INTO supplier_commercial_terms (
      supplier_id, pedido_minimo_tipo, pedido_minimo,
      frete_tipo, frete_gratis_acima, frete_valor,
      dias_pedido, prazo_entrega_cd_dias, active
    ) VALUES (
      p_supplier_id, p_pedido_minimo_tipo, p_pedido_minimo,
      p_frete_tipo, p_frete_gratis_acima, p_frete_valor,
      p_dias_pedido, p_prazo_entrega_cd_dias, false
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'terms_id', v_id, 'status', 'proposta_pendente');
  END IF;
END;
$$;

-- Fornecedor pode ver proprias propostas (leitura já coberta pela policy existente)
-- Precisamos permitir INSERT para o fornecedor
DROP POLICY IF EXISTS "supplier propose terms" ON public.supplier_commercial_terms;
CREATE POLICY "supplier propose terms"
  ON public.supplier_commercial_terms FOR INSERT
  WITH CHECK (public.owns_supplier(supplier_id));

-- ============================================================================
-- 8. COMENTÁRIOS
-- ============================================================================

COMMENT ON FUNCTION public.promote_pending_offers(text) IS
  'Promove offers pendente_condicoes → ativa para o supplier indicado. Só executa se supplier é operacionalmente ativo.';

COMMENT ON FUNCTION public.trg_promote_offers_on_terms() IS
  'Trigger: ao ativar commercial terms, promove automaticamente offers pendentes do supplier.';

COMMENT ON FUNCTION public.propose_commercial_terms(text, text, int, text, int, int, int[], int) IS
  'Fornecedor propõe condições comerciais (active=false, aguarda admin). Admin pode inserir direto (active=true).';

COMMENT ON CONSTRAINT supplier_offers_status_check ON public.supplier_offers IS
  'Status permitidos: ativa, indisponivel, vencida, escolhida, pendente_condicoes. Pendente = supplier sem terms operacionais.';
