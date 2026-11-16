-- ============================================================================
-- Migration 0027: Etapa 1 — R3/R4 compliance + PO grouping fix
-- ============================================================================
-- R3.1+R3.3: publish_product propaga sale_mode da oferta; set_product_sale_mode
--            com guard direcao + teto de sobra para unidade_e_caixa
-- R4.1: Horário de corte global configurável (default "17:30")
-- R4.2: Tabela de feriados (ccm_configs) + add_business_days respeita feriados
-- R4.1+R4.2: calculate_next_cycle_date com cutoff + calculate_expected_availability
-- R4.2: auto_switch_sourcing_safe agora calcula e grava expected_availability_date
-- PO fix: generate_purchase_order usa custo da oferta ativa, não MAX(snapshots)
--
-- NOTE: auto_switch_sourcing_safe RPC é definida em 0026 (versão autoritativa).
-- 0026 tem os column names corretos e atualiza products em todos os cenários.
-- ============================================================================

BEGIN;

-- ============================================================================
-- Audit trail: section_configs changes (spec: toda alteração grava quem, quando, valor anterior)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.section_config_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_slug    text NOT NULL,
  field_name      text NOT NULL,
  old_value       numeric,
  new_value       numeric,
  changed_by      uuid REFERENCES auth.users(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS section_config_history_section_idx
  ON public.section_config_history (section_slug, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_section_config_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.package_discount_pct IS DISTINCT FROM NEW.package_discount_pct THEN
    INSERT INTO section_config_history (section_slug, field_name, old_value, new_value, changed_by)
    VALUES (NEW.section_slug, 'package_discount_pct', OLD.package_discount_pct, NEW.package_discount_pct, auth.uid());
  END IF;
  IF OLD.auto_price_increase_limit_pct IS DISTINCT FROM NEW.auto_price_increase_limit_pct THEN
    INSERT INTO section_config_history (section_slug, field_name, old_value, new_value, changed_by)
    VALUES (NEW.section_slug, 'auto_price_increase_limit_pct', OLD.auto_price_increase_limit_pct, NEW.auto_price_increase_limit_pct, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_section_config_audit ON public.section_configs;
CREATE TRIGGER trg_section_config_audit
  AFTER UPDATE ON public.section_configs
  FOR EACH ROW EXECUTE FUNCTION public.log_section_config_change();

REVOKE ALL ON public.section_config_history FROM anon;

-- ============================================================================
-- R4.1: Horário de corte global (default 17:30)
-- ============================================================================
INSERT INTO public.ccm_configs (key, scope, scope_ref, value, updated_by)
VALUES ('horario_corte_ciclo', 'global', NULL, '"17:30"'::jsonb, NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- R4.2: Tabela de feriados + config inicial vazia
-- ============================================================================
INSERT INTO public.ccm_configs (key, scope, scope_ref, value, updated_by)
VALUES ('feriados', 'global', NULL, '[]'::jsonb, NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- R4.2: add_business_days agora lê feriados de ccm_configs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.add_business_days(
  p_start date,
  p_days  int
) RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_result    date := p_start;
  v_remaining int := p_days;
  v_holidays  text[];
BEGIN
  IF p_days <= 0 THEN RETURN p_start; END IF;

  SELECT array_agg(h::text)
    INTO v_holidays
    FROM ccm_configs c,
         jsonb_array_elements_text(c.value) AS h
   WHERE c.key = 'feriados' AND c.scope = 'global';

  v_holidays := COALESCE(v_holidays, '{}');

  WHILE v_remaining > 0 LOOP
    v_result := v_result + 1;
    IF extract(dow FROM v_result)::int NOT IN (0, 6)
       AND v_result::text != ALL(v_holidays) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- R4.1: calculate_next_cycle_date com suporte a timestamp + cutoff
-- ============================================================================
-- Corrige bug original: dia de pedido=hoje retornava próxima semana (diff 0→7).
-- Agora: se antes do corte e hoje é dia de pedido → retorna hoje.
CREATE OR REPLACE FUNCTION public.calculate_next_cycle_date(
  p_dias_pedido int[],
  p_from_date   date DEFAULT CURRENT_DATE,
  p_hora        time DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cutoff   text;
  v_dow      int;
  v_day      int;
  v_cursor   date;
BEGIN
  IF p_dias_pedido IS NULL OR array_length(p_dias_pedido, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.value #>> '{}' INTO v_cutoff
    FROM ccm_configs c
   WHERE c.key = 'horario_corte_ciclo' AND c.scope = 'global';
  v_cutoff := COALESCE(v_cutoff, '17:30');

  v_dow := extract(dow FROM p_from_date)::int;

  IF p_hora IS NULL OR p_hora::text < v_cutoff THEN
    IF v_dow = ANY(p_dias_pedido) THEN
      RETURN p_from_date;
    END IF;
  END IF;

  v_cursor := p_from_date;
  FOR i IN 1..14 LOOP
    v_cursor := v_cursor + 1;
    IF extract(dow FROM v_cursor)::int = ANY(p_dias_pedido) THEN
      RETURN v_cursor;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ============================================================================
-- R4.1+R4.2: calculate_expected_availability com cutoff + feriados
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_expected_availability(
  p_dias_pedido            int[],
  p_prazo_entrega_cd_dias  int,
  p_from_date              date DEFAULT CURRENT_DATE,
  p_hora                   time DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_next_cycle date;
BEGIN
  v_next_cycle := public.calculate_next_cycle_date(p_dias_pedido, p_from_date, p_hora);
  IF v_next_cycle IS NULL THEN RETURN NULL; END IF;
  RETURN public.add_business_days(v_next_cycle, COALESCE(p_prazo_entrega_cd_dias, 0));
END;
$$;

-- ============================================================================
-- NOTE: auto_switch_sourcing_safe RPC is defined in 0026 (authoritative version).
-- 0026 has the correct column names (sourcing_selections does NOT have supplier_id),
-- updates products table (cost_centavos, supplier_id, winning_offer_id),
-- and handles all R5/R6 edge cases including no-price-change supplier updates.
-- DO NOT redefine it here — CREATE OR REPLACE would overwrite 0026's version.
-- ============================================================================

-- ============================================================================
-- PO grouping fix: use current active offer cost, not MAX(requirement snapshots)
-- ============================================================================
-- When multiple requirements for the same product have different cost snapshots
-- (e.g. offer price changed mid-cycle), the PO item should use the active
-- offer's current cost, not MAX of the snapshots.
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
  v_total_qty  bigint := 0;
  v_freight    int := 0;
  v_count      int := 0;
  v_min_met    boolean;
  v_req        record;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF NOT public.is_supplier_operationally_active(p_supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor sem condições comerciais ativas.');
  END IF;

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
      -- Use current active offer cost instead of requirement snapshot
      COALESCE(
        (SELECT so.unit_cost_centavos FROM supplier_offers so
         WHERE so.supplier_id = p_supplier_id
           AND so.master_product_id = pr.master_product_id
           AND so.status = 'ativa' AND so.replaced_at IS NULL
         ORDER BY so.created_at DESC LIMIT 1),
        MAX(pr.unit_cost_centavos)
      ) AS unit_cost,
      COALESCE(
        (SELECT so.cost_centavos FROM supplier_offers so
         WHERE so.supplier_id = p_supplier_id
           AND so.master_product_id = pr.master_product_id
           AND so.status = 'ativa' AND so.replaced_at IS NULL
         ORDER BY so.created_at DESC LIMIT 1),
        MAX(pr.pack_cost_centavos)
      ) AS pack_cost,
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
      v_total_qty := v_total_qty + v_actual_units;
      v_count := v_count + 1;
    END;
  END LOOP;

  -- Frete
  IF v_terms.frete_tipo = 'fixo' THEN
    v_freight := COALESCE((v_terms.frete_valor * 100)::int, 0);
  ELSIF v_terms.frete_tipo = 'gratis_acima' THEN
    IF v_subtotal >= COALESCE((v_terms.frete_gratis_acima * 100)::bigint, 0) THEN
      v_freight := 0;
    ELSE
      v_freight := COALESCE((v_terms.frete_valor * 100)::int, 0);
    END IF;
  END IF;

  -- P1.8: Pedido mínimo (R4.3) — checar valor E volume
  IF v_terms.pedido_minimo_tipo = 'valor' AND v_terms.pedido_minimo IS NOT NULL THEN
    v_min_met := v_subtotal >= (v_terms.pedido_minimo * 100)::bigint;
  ELSIF v_terms.pedido_minimo_tipo = 'volume' AND v_terms.pedido_minimo IS NOT NULL THEN
    v_min_met := v_total_qty >= v_terms.pedido_minimo;
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
-- LACUNA 1: R3.1+R3.3 — publish_product propaga sale_mode + packaging da oferta
-- ============================================================================
-- Redefine publish_product para copiar sale_mode, unidade_compra, qtd_por_embalagem,
-- package_discount_pct da oferta para o produto.
-- Guard R3.1: se sale_mode = 'unidade_e_caixa', exige has_permission('direcao').
-- Guard R3.3: se sale_mode = 'unidade_e_caixa', teto de sobra não pode estar atingido.

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
  v_sale_mode            text;
  v_leftover_total       bigint;
  v_leftover_ceiling     int;
  v_pkg_discount         numeric;
  v_exp_avail            date;
  v_terms                record;
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

  -- 4c. R3.1+R3.3: sale_mode propagation + guards
  v_sale_mode := COALESCE(v_offer.sale_mode, 'por_unidade');

  IF v_sale_mode = 'unidade_e_caixa' THEN
    -- R3.1: exige permissão de direção
    IF NOT public.has_permission('direcao') THEN
      RETURN jsonb_build_object('error', 'Modo unidade_e_caixa requer permissão de direção (R3.1).');
    END IF;

    -- R3.3: teto de sobra
    v_leftover_total := public.calculate_leftover_total_value();
    SELECT (c.value)::int INTO v_leftover_ceiling
      FROM ccm_configs c
     WHERE c.key = 'leftover_ceiling_centavos' AND c.scope = 'global' LIMIT 1;
    IF v_leftover_ceiling IS NOT NULL AND v_leftover_total >= v_leftover_ceiling THEN
      RETURN jsonb_build_object('error',
        format('Teto de sobra atingido (R$ %s de R$ %s). Não é possível ativar unidade_e_caixa (R3.3).',
          (v_leftover_total / 100.0)::numeric(12,2), (v_leftover_ceiling / 100.0)::numeric(12,2)));
    END IF;
  END IF;

  -- Resolve package_discount_pct from section_configs
  v_pkg_discount := NULL;
  IF v_sale_mode = 'unidade_e_caixa' THEN
    SELECT sc.package_discount_pct INTO v_pkg_discount
      FROM section_configs sc
     WHERE sc.section_slug = v_mp.category_slug
     LIMIT 1;
    v_pkg_discount := COALESCE(v_pkg_discount, 0);
  END IF;

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

  -- 12b. R4.2: calculate expected_availability_date
  v_exp_avail := NULL;
  SELECT * INTO v_terms
    FROM supplier_commercial_terms
   WHERE supplier_id = v_offer.supplier_id AND active = true AND valid_to IS NULL
   LIMIT 1;
  IF v_terms IS NOT NULL AND v_terms.dias_pedido IS NOT NULL THEN
    v_exp_avail := public.calculate_expected_availability(
      v_terms.dias_pedido,
      COALESCE(v_terms.prazo_entrega_cd_dias, 0),
      CURRENT_DATE,
      (now() AT TIME ZONE 'America/Sao_Paulo')::time
    );
  END IF;

  -- 13. Upsert product (now includes sale_mode, packaging, expected_availability_date)
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
      sale_mode = v_sale_mode,
      unidade_compra = v_offer.unidade_compra,
      qtd_por_embalagem = COALESCE(v_offer.qtd_por_embalagem, 1),
      package_discount_pct = v_pkg_discount,
      expected_availability_date = v_exp_avail,
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
      sale_mode, unidade_compra, qtd_por_embalagem, package_discount_pct,
      expected_availability_date, active
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
      v_sale_mode, v_offer.unidade_compra,
      COALESCE(v_offer.qtd_por_embalagem, 1), v_pkg_discount,
      v_exp_avail, true
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
    'stock_action', v_stock_action,
    'sale_mode', v_sale_mode,
    'expected_availability_date', v_exp_avail
  );
END;
$$;

-- ============================================================================
-- LACUNA 1b: set_product_sale_mode — standalone RPC for changing sale_mode
-- ============================================================================
-- R3.1: unidade_e_caixa requires direcao permission
-- R3.3: blocked if leftover ceiling reached

CREATE OR REPLACE FUNCTION public.set_product_sale_mode(
  p_master_product_id uuid,
  p_sale_mode         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_leftover_total  bigint;
  v_leftover_ceiling int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF p_sale_mode NOT IN ('por_unidade', 'embalagem_fechada', 'unidade_e_caixa', 'nao_vender') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Modo de venda inválido.');
  END IF;

  IF p_sale_mode = 'unidade_e_caixa' THEN
    IF NOT public.has_permission('direcao') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Modo unidade_e_caixa requer permissão de direção (R3.1).');
    END IF;

    v_leftover_total := public.calculate_leftover_total_value();
    SELECT (c.value)::int INTO v_leftover_ceiling
      FROM ccm_configs c
     WHERE c.key = 'leftover_ceiling_centavos' AND c.scope = 'global' LIMIT 1;
    IF v_leftover_ceiling IS NOT NULL AND v_leftover_total >= v_leftover_ceiling THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Teto de sobra atingido (R$ %s de R$ %s). Bloqueado (R3.3).',
          (v_leftover_total / 100.0)::numeric(12,2), (v_leftover_ceiling / 100.0)::numeric(12,2)));
    END IF;
  END IF;

  UPDATE products
     SET sale_mode = p_sale_mode, updated_at = now()
   WHERE master_product_id = p_master_product_id::text
     AND active = true AND publish_status = 'publicada';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Produto publicado não encontrado.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'sale_mode', p_sale_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_sale_mode FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_sale_mode FROM anon;
GRANT EXECUTE ON FUNCTION public.set_product_sale_mode TO authenticated;

-- ============================================================================
-- LACUNA 3: R4.2 — auto_switch_sourcing_safe agora grava expected_availability_date
-- ============================================================================
-- Patch the product UPDATE branches in 0026's auto_switch_sourcing_safe to also
-- write expected_availability_date. Since we can't partially patch a function,
-- we redefine the entire function (CREATE OR REPLACE overwrites 0026's version).

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
  -- Guard 1: somente admin
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  -- Guard 2: auto_switch_enabled
  SELECT (value)::boolean INTO v_auto_switch
    FROM ccm_configs WHERE key = 'auto_switch_enabled' AND scope = 'global' LIMIT 1;
  IF v_auto_switch IS NULL OR v_auto_switch = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auto_switch_enabled desativado.');
  END IF;

  -- Guard 3: offer nova — lock + validação
  SELECT * INTO v_new_offer FROM supplier_offers
   WHERE id = p_new_offer_id AND status = 'ativa' AND replaced_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Oferta não está mais ativa.');
  END IF;

  -- Guard 4: supplier operacional
  IF NOT public.is_supplier_operationally_active(v_new_offer.supplier_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor não está operacionalmente ativo.');
  END IF;

  -- Guard 5: estoque e custo
  IF v_new_offer.stock <= 0 OR v_new_offer.cost_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Oferta sem estoque ou custo zerado.');
  END IF;

  -- Guard 5b: custo não mudou (anti-TOCTOU)
  IF p_expected_new_cost_centavos IS NOT NULL
     AND v_new_offer.cost_centavos != p_expected_new_cost_centavos THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Custo mudou desde o cálculo.',
      'expected', p_expected_new_cost_centavos,
      'actual', v_new_offer.cost_centavos
    );
  END IF;

  -- Guard 6: old offer TOCTOU
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

  -- Noop se já aponta para mesma offer
  IF v_old_selection IS NOT NULL AND v_old_selection.supplier_offer_id = p_new_offer_id THEN
    RETURN jsonb_build_object('ok', true, 'action', 'noop');
  END IF;

  -- Produto publicado: checar preço (R5.3/R5.4/R6.3)
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

  -- R4.2: calculate expected_availability_date for new supplier
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

  -- =========================================================================
  -- MUTAÇÕES — switch always proceeds (R6.1)
  -- =========================================================================

  -- M1: Encerrar seleção anterior
  IF v_old_selection IS NOT NULL THEN
    UPDATE sourcing_selections SET replaced_at = now()
    WHERE id = v_old_selection.id;
  END IF;

  -- M2: Nova seleção
  INSERT INTO sourcing_selections (
    master_product_id, supplier_offer_id, selected_by,
    note, score, ambiguous, ranking_snapshot
  ) VALUES (
    p_master_product_id, p_new_offer_id, auth.uid(),
    p_note, p_score, false, p_ranking_snapshot
  )
  RETURNING id INTO v_selection_id;

  -- M3: Log de troca
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

  -- M4: Preço — auto-apply if safe, block if not (R5.3/R5.4/R6.3)
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

COMMIT;
