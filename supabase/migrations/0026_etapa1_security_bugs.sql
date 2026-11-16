-- ============================================================================
-- Migration 0026: Etapa 1 — P0 Security + P1 SQL Bug Fixes
-- ============================================================================
-- Correções baseadas em CORRECOES_ETAPA1.md (auditoria contra o documento
-- "CCM — Estrutura de Operação da Plataforma — Etapa 1").
--
-- P0: 5 vulnerabilidades de segurança
-- P1: bugs em funções SQL (integer division, wrong columns, volume minimum, etc.)
-- P2 parcial: is_supplier_operationally_active aceitar volume
-- ============================================================================

BEGIN;

-- ============================================================================
-- P0.1 — Escalada de permissão: proteger profiles.permissions
-- ============================================================================
-- A policy "own profile update" só bloqueia `role`. Qualquer usuário consegue
-- gravar `permissions = '{direcao}'`. Agora bloqueia ambos.

DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (
    (
      auth.uid() = id
      AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
      AND COALESCE(permissions, '{}') = (SELECT COALESCE(p.permissions, '{}') FROM public.profiles p WHERE p.id = auth.uid())
    )
    OR public.is_admin()
  );

-- ============================================================================
-- P0.2 — Fornecedor se ativa sozinho: remover INSERT policy direta
-- ============================================================================
-- A policy "supplier propose terms" permite INSERT com active=true direto,
-- bypass do RPC propose_commercial_terms. Removê-la.

DROP POLICY IF EXISTS "supplier propose terms" ON public.supplier_commercial_terms;

-- ============================================================================
-- P0.3 — Dados de fornecedor expostos a visitantes
-- ============================================================================
-- O modelo 1P não expõe fornecedor ao cliente. Remover leitura pública.

DROP POLICY IF EXISTS "public read suppliers" ON public.suppliers;

-- ============================================================================
-- P0.4 — Views sem controle de acesso
-- ============================================================================
-- v_leftover_summary e v_daily_operations rodam como dono, sem RLS.
-- Recriar com security_invoker = true e revogar acesso de anon.

CREATE OR REPLACE VIEW public.v_leftover_summary
WITH (security_invoker = true)
AS
SELECT
  i.master_product_id,
  mp.name AS product_name,
  mp.category_slug,
  i.quantity,
  i.unit_cost_centavos,
  i.total_value_centavos,
  i.updated_at,
  (SELECT (c.value)::int FROM public.ccm_configs c
   WHERE c.key = 'leftover_ceiling_centavos' AND c.scope = 'global' LIMIT 1
  ) AS ceiling_centavos
FROM public.ccm_inventory i
JOIN public.master_products mp ON mp.id = i.master_product_id
WHERE i.quantity > 0;

REVOKE ALL ON public.v_leftover_summary FROM anon;

CREATE OR REPLACE VIEW public.v_daily_operations
WITH (security_invoker = true)
AS
WITH price_changes AS (
  SELECT
    (pc.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS report_date,
    'price_change' AS event_type,
    pc.product_id,
    mp.name AS product_name,
    pc.old_price_centavos,
    pc.new_price_centavos,
    pc.change_pct,
    pc.auto_applied,
    pc.blocked,
    NULL::text AS old_supplier_name,
    NULL::text AS new_supplier_name,
    NULL::text AS reason,
    pc.created_at
  FROM public.price_change_log pc
  LEFT JOIN public.master_products mp ON mp.id = pc.master_product_id
),
replacements AS (
  SELECT
    (rl.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS report_date,
    'supplier_replacement' AS event_type,
    rl.product_id,
    mp.name AS product_name,
    rl.old_cost_centavos AS old_price_centavos,
    rl.new_cost_centavos AS new_price_centavos,
    rl.price_change_pct AS change_pct,
    rl.auto_applied,
    false AS blocked,
    os.name AS old_supplier_name,
    ns.name AS new_supplier_name,
    rl.reason,
    rl.created_at
  FROM public.supplier_replacement_log rl
  LEFT JOIN public.master_products mp ON mp.id = rl.master_product_id
  LEFT JOIN public.suppliers os ON os.id = rl.old_supplier_id
  LEFT JOIN public.suppliers ns ON ns.id = rl.new_supplier_id
),
purchase_orders AS (
  SELECT
    spo.cycle_date AS report_date,
    'purchase_order' AS event_type,
    NULL::text AS product_id,
    s.name AS product_name,
    spo.total_centavos AS old_price_centavos,
    CASE WHEN spo.minimum_value IS NOT NULL THEN (spo.minimum_value * 100)::int END AS new_price_centavos,
    NULL::numeric AS change_pct,
    false AS auto_applied,
    NOT spo.minimum_met AS blocked,
    NULL::text AS old_supplier_name,
    s.name AS new_supplier_name,
    spo.status AS reason,
    spo.created_at
  FROM public.supplier_purchase_orders spo
  LEFT JOIN public.suppliers s ON s.id = spo.supplier_id
)
SELECT * FROM price_changes
UNION ALL
SELECT * FROM replacements
UNION ALL
SELECT * FROM purchase_orders
ORDER BY created_at DESC;

REVOKE ALL ON public.v_daily_operations FROM anon;

-- ============================================================================
-- P0.5 — "Quem alterou" pode ser forjado + ccm_configs bypass
-- ============================================================================
-- save_ccm_config agora ignora p_admin_id e usa sempre auth.uid().
-- Remover policy FOR ALL de ccm_configs: escrita só via RPC.

CREATE OR REPLACE FUNCTION public.save_ccm_config(
  p_key       text,
  p_scope     text,
  p_scope_ref text,
  p_value     jsonb,
  p_admin_id  uuid DEFAULT NULL  -- mantido por compatibilidade de assinatura, IGNORADO
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id   uuid;
  v_existing   record;
  v_config_id  uuid;
  v_scope_ref  text;
BEGIN
  v_admin_id := auth.uid();  -- SEMPRE o chamador real (P0.5)
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  v_scope_ref := NULLIF(TRIM(COALESCE(p_scope_ref, '')), '');

  SELECT id, value INTO v_existing
    FROM ccm_configs
   WHERE key = p_key
     AND scope = p_scope
     AND COALESCE(scope_ref, '') = COALESCE(v_scope_ref, '');

  IF v_existing IS NOT NULL THEN
    INSERT INTO ccm_config_history (config_id, key, scope, scope_ref, old_value, new_value, changed_by)
    VALUES (v_existing.id, p_key, p_scope, v_scope_ref, v_existing.value, p_value, v_admin_id);

    UPDATE ccm_configs SET value = p_value, updated_by = v_admin_id
    WHERE id = v_existing.id;

    RETURN jsonb_build_object('ok', true, 'action', 'updated', 'config_id', v_existing.id);
  ELSE
    INSERT INTO ccm_configs (key, scope, scope_ref, value, updated_by)
    VALUES (p_key, p_scope, v_scope_ref, p_value, v_admin_id)
    RETURNING id INTO v_config_id;

    INSERT INTO ccm_config_history (config_id, key, scope, scope_ref, old_value, new_value, changed_by)
    VALUES (v_config_id, p_key, p_scope, v_scope_ref, NULL, p_value, v_admin_id);

    RETURN jsonb_build_object('ok', true, 'action', 'created', 'config_id', v_config_id);
  END IF;
END;
$$;

-- Forçar escrita via RPC (sem policy de INSERT/UPDATE/DELETE direto)
DROP POLICY IF EXISTS "admin all ccm_configs" ON public.ccm_configs;
CREATE POLICY "admin read ccm_configs" ON public.ccm_configs FOR SELECT
  USING (public.is_admin());

-- ============================================================================
-- P1.5 — R2.2 integer division truncates (0016 + 0020)
-- ============================================================================
-- p_cost_centavos / qtd é divisão inteira. Corrigir em ensure_offer_for_approved_item.

CREATE OR REPLACE FUNCTION public.ensure_offer_for_approved_item(
  p_master_product_id text,
  p_supplier_id       text,
  p_catalog_item_id   text,
  p_cost_centavos     int,
  p_stock             int,
  p_lead_time_days    int DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_operational  boolean;
  v_target_status text;
  v_existing     record;
  v_offer_id     uuid;
  v_unidade_compra text;
  v_qtd_emb      int;
  v_vende_avulso boolean;
  v_unit_cost    int;
BEGIN
  v_operational := public.is_supplier_operationally_active(p_supplier_id);
  v_target_status := CASE WHEN v_operational THEN 'ativa' ELSE 'pendente_condicoes' END;

  SELECT sci.unidade_compra, sci.qtd_por_embalagem, sci.vende_avulso
    INTO v_unidade_compra, v_qtd_emb, v_vende_avulso
    FROM supplier_catalog_items sci
   WHERE sci.id = p_catalog_item_id;

  v_unidade_compra := COALESCE(v_unidade_compra, 'unidade');
  v_qtd_emb := COALESCE(v_qtd_emb, 1);
  v_vende_avulso := COALESCE(v_vende_avulso, true);
  -- P1.5: usar round(numeric / int) em vez de integer division
  v_unit_cost := round(p_cost_centavos::numeric / GREATEST(v_qtd_emb, 1));

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
      cost_centavos, unit_cost_centavos, stock, lead_time_days, status,
      unidade_compra, qtd_por_embalagem, vende_avulso
    ) VALUES (
      p_master_product_id, p_supplier_id, p_catalog_item_id,
      p_cost_centavos, v_unit_cost, p_stock, p_lead_time_days, v_target_status,
      v_unidade_compra, v_qtd_emb, v_vende_avulso
    )
    RETURNING id INTO v_offer_id;

    RETURN jsonb_build_object('ok', true, 'offer_id', v_offer_id, 'action', 'created', 'status', v_target_status);
  ELSE
    UPDATE supplier_offers SET
      cost_centavos = p_cost_centavos,
      unit_cost_centavos = v_unit_cost,
      stock = p_stock,
      lead_time_days = p_lead_time_days,
      catalog_item_id = p_catalog_item_id,
      unidade_compra = v_unidade_compra,
      qtd_por_embalagem = v_qtd_emb,
      vende_avulso = v_vende_avulso,
      status = v_target_status,
      updated_at = now()
    WHERE id = v_existing.id;

    RETURN jsonb_build_object('ok', true, 'offer_id', v_existing.id, 'action', 'updated', 'status', v_target_status);
  END IF;
END;
$$;

-- ============================================================================
-- P1.8 — R4.3 volume minimum always treated as met (0020)
-- ============================================================================
-- generate_purchase_order: quando pedido_minimo_tipo = 'volume', comparar
-- quantidade total com pedido_minimo.
-- P1.7 — wait_next_cycle: mover requirements para o próximo cycle_date.
-- P2/R1.1 — is_supplier_operationally_active: aceitar volume também.
-- ============================================================================

-- Fix R1.1: aceitar qualquer pedido_minimo_tipo, não só 'valor'
CREATE OR REPLACE FUNCTION public.is_supplier_operationally_active(p_supplier_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.supplier_commercial_terms
    WHERE supplier_id = p_supplier_id
    AND active = true
    AND valid_to IS NULL
  );
$$;

-- Fix generate_purchase_order: volume minimum + quantity accumulation
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
-- P1.7 — wait_next_cycle: mover requirements para o próximo cycle_date
-- ============================================================================

CREATE OR REPLACE FUNCTION public.decide_minimum_shortfall(
  p_purchase_order_id uuid,
  p_decision          text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_po       record;
  v_terms    record;
  v_next_cycle date;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF p_decision NOT IN ('complete_order', 'send_extra', 'wait_next_cycle') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisão inválida.');
  END IF;

  SELECT * INTO v_po FROM public.supplier_purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.');
  END IF;
  IF v_po.status <> 'minimum_not_met' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está com mínimo pendente.');
  END IF;

  UPDATE public.supplier_purchase_orders SET
    decision = p_decision,
    decided_by = v_admin_id,
    decided_at = now(),
    status = CASE p_decision
      WHEN 'wait_next_cycle' THEN 'cancelled'
      ELSE 'ready'
    END
  WHERE id = p_purchase_order_id;

  -- P1.7: Se "esperar", mover requirements para o PRÓXIMO cycle_date
  IF p_decision = 'wait_next_cycle' THEN
    -- Calcular próximo cycle_date do fornecedor
    SELECT sct.* INTO v_terms
    FROM public.supplier_commercial_terms sct
    WHERE sct.supplier_id = v_po.supplier_id AND sct.active = true AND sct.valid_to IS NULL;

    IF v_terms IS NOT NULL AND v_terms.dias_pedido IS NOT NULL THEN
      v_next_cycle := public.calculate_next_cycle_date(
        v_po.supplier_id,
        (v_po.cycle_date + 1)::date
      );
    ELSE
      v_next_cycle := v_po.cycle_date + 7;
    END IF;

    UPDATE public.purchase_requirements
    SET status = 'pending',
        purchase_order_id = NULL,
        cycle_date = v_next_cycle
    WHERE purchase_order_id = p_purchase_order_id AND status = 'included';
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

-- ============================================================================
-- P1.2 — auto_switch_sourcing_safe: wrong column names for section_configs
-- ============================================================================
-- Corrigir sc.section → sc.section_slug e sc.key/sc.value → coluna direta.

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

      -- R5.5: reduction always auto-applies
      -- R5.3: increase within limit auto-applies
      -- R5.4/R6.3: increase above limit → blocked
      IF v_change_pct > 0 AND v_change_pct > v_limit_pct THEN
        v_price_blocked := true;
      END IF;
    END IF;
  END IF;

  -- Also accept pre-computed blocked flag from TS
  IF p_price_blocked THEN
    v_price_blocked := true;
  END IF;

  -- =========================================================================
  -- MUTAÇÕES — switch always proceeds (R6.1)
  -- =========================================================================

  -- M1: Encerrar seleção anterior
  IF v_old_selection IS NOT NULL THEN
    UPDATE sourcing_selections SET replaced_at = now()
    WHERE id = v_old_selection.id;
  END IF;

  -- M2: Nova seleção (column: supplier_offer_id, NOT offer_id)
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
    -- R6.3: switch supplier, keep old price, create BLOCKED price change log
    UPDATE products
       SET cost_centavos = v_new_offer.cost_centavos,
           supplier_id = v_new_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_selection_id,
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
    -- Price doesn't change, but update supplier/offer/cost
    UPDATE products
       SET cost_centavos = v_new_offer.cost_centavos,
           supplier_id = v_new_offer.supplier_id,
           winning_offer_id = p_new_offer_id,
           sourcing_selection_id = v_selection_id,
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
    'change_pct', v_change_pct
  );
END;
$$;

COMMIT;
