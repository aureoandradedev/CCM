-- ============================================================================
-- CCM · Migration 0018 — Motor de ciclo de compra (Fases 14-16)
-- ============================================================================
--
-- R4.1: Vendas acumulam por fornecedor, viram PO no próximo dia de pedido.
-- R4.2: Prazo ao cliente = próximo dia de pedido + prazo_entrega_cd_dias.
-- R4.3: Se total < pedido_minimo, PO não envia + notificação com opções.
--
-- Tabelas:
--   purchase_requirements           — necessidades acumuladas
--   supplier_purchase_orders        — pedidos de compra
--   purchase_order_items            — itens do pedido
--
-- Funções:
--   calculate_next_cycle_date       — próximo dia de pedido
--   add_business_days               — soma dias úteis (seg-sex)
--   calculate_expected_availability — R4.2 data de disponibilidade
--   generate_purchase_order         — gera PO a partir de requirements
--   decide_minimum_shortfall        — decisão manual quando mínimo não atingido
-- ============================================================================

-- ============================================================================
-- 1. FUNÇÕES DE DATA
-- ============================================================================

-- Próximo dia de pedido dado dias_pedido (0=dom, 1=seg...6=sab) e data ref.
-- Postgres extract(dow) retorna 0=dom...6=sab — mesma convenção.
CREATE OR REPLACE FUNCTION public.calculate_next_cycle_date(
  p_dias_pedido int[],
  p_from_date   date DEFAULT CURRENT_DATE
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_dow int;
  v_min_diff int := 8;
  v_diff int;
  v_day int;
BEGIN
  IF p_dias_pedido IS NULL OR array_length(p_dias_pedido, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  v_dow := extract(dow FROM p_from_date)::int;
  FOREACH v_day IN ARRAY p_dias_pedido LOOP
    v_diff := v_day - v_dow;
    IF v_diff <= 0 THEN v_diff := v_diff + 7; END IF;
    IF v_diff < v_min_diff THEN v_min_diff := v_diff; END IF;
  END LOOP;
  RETURN p_from_date + v_min_diff;
END;
$$;

-- Adiciona dias úteis (seg-sex). LACUNA: feriados não definidos pelo documento.
CREATE OR REPLACE FUNCTION public.add_business_days(
  p_start date,
  p_days  int
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_result date := p_start;
  v_remaining int := p_days;
BEGIN
  IF p_days <= 0 THEN RETURN p_start; END IF;
  WHILE v_remaining > 0 LOOP
    v_result := v_result + 1;
    IF extract(dow FROM v_result)::int NOT IN (0, 6) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- R4.2: Data estimada = próximo ciclo + prazo_entrega_cd_dias úteis
CREATE OR REPLACE FUNCTION public.calculate_expected_availability(
  p_dias_pedido            int[],
  p_prazo_entrega_cd_dias  int,
  p_from_date              date DEFAULT CURRENT_DATE
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_next_cycle date;
BEGIN
  v_next_cycle := public.calculate_next_cycle_date(p_dias_pedido, p_from_date);
  IF v_next_cycle IS NULL THEN RETURN NULL; END IF;
  RETURN public.add_business_days(v_next_cycle, COALESCE(p_prazo_entrega_cd_dias, 0));
END;
$$;

-- ============================================================================
-- 2. PURCHASE_REQUIREMENTS — necessidades de compra acumuladas
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_requirements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id        text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  master_product_id  uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  source_order_id    uuid,
  source_order_item_id uuid,
  quantity_units     int NOT NULL CHECK (quantity_units > 0),
  unit_cost_centavos int,
  pack_cost_centavos int,
  qtd_por_embalagem  int NOT NULL DEFAULT 1 CHECK (qtd_por_embalagem >= 1),
  unidade_compra     text NOT NULL DEFAULT 'unidade',
  cycle_date         date NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'included', 'held', 'cancelled')),
  purchase_order_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_requirements_supplier_cycle_idx
  ON public.purchase_requirements (supplier_id, cycle_date, status);

CREATE INDEX IF NOT EXISTS purchase_requirements_pending_idx
  ON public.purchase_requirements (supplier_id, status)
  WHERE status = 'pending';

-- ============================================================================
-- 3. SUPPLIER_PURCHASE_ORDERS — pedidos de compra
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       text NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  cycle_date        date NOT NULL,

  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN (
                      'draft',
                      'minimum_not_met',
                      'ready',
                      'sent',
                      'received',
                      'partial',
                      'cancelled'
                    )),

  subtotal_centavos int NOT NULL DEFAULT 0,
  freight_centavos  int NOT NULL DEFAULT 0,
  total_centavos    int NOT NULL DEFAULT 0,
  item_count        int NOT NULL DEFAULT 0,

  -- Pedido mínimo (snapshot das condições)
  minimum_type      text,
  minimum_value     numeric(12,2),
  minimum_met       boolean NOT NULL DEFAULT false,

  -- R4.3: decisão quando mínimo não atingido
  decision          text CHECK (decision IS NULL OR decision IN (
    'complete_order',
    'send_extra',
    'wait_next_cycle'
  )),
  decided_by        uuid REFERENCES auth.users(id),
  decided_at        timestamptz,

  -- Frete (snapshot das condições)
  freight_type      text,
  freight_free_above numeric(12,2),
  freight_value     numeric(12,2),

  expected_delivery date,
  notes             text,
  sent_at           timestamptz,
  sent_by           uuid REFERENCES auth.users(id),
  received_at       timestamptz,
  received_by       uuid REFERENCES auth.users(id),

  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER supplier_purchase_orders_updated_at
  BEFORE UPDATE ON public.supplier_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx
  ON public.supplier_purchase_orders (supplier_id, cycle_date DESC);

CREATE INDEX IF NOT EXISTS purchase_orders_status_idx
  ON public.supplier_purchase_orders (status, cycle_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_supplier_cycle_uniq
  ON public.supplier_purchase_orders (supplier_id, cycle_date)
  WHERE status NOT IN ('cancelled');

-- FK de purchase_requirements → purchase_orders
ALTER TABLE public.purchase_requirements
  ADD CONSTRAINT purchase_requirements_po_fk
  FOREIGN KEY (purchase_order_id)
  REFERENCES public.supplier_purchase_orders(id) ON DELETE SET NULL;

-- FK de inventory_movements → purchase_orders (coluna criada em 0017)
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_po_fk
  FOREIGN KEY (source_purchase_order_id)
  REFERENCES public.supplier_purchase_orders(id);

-- ============================================================================
-- 4. PURCHASE_ORDER_ITEMS — itens do pedido
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid NOT NULL REFERENCES public.supplier_purchase_orders(id) ON DELETE CASCADE,
  master_product_id  uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  product_name       text NOT NULL,
  quantity_units     int NOT NULL CHECK (quantity_units > 0),
  pack_count         int NOT NULL DEFAULT 1 CHECK (pack_count >= 1),
  qtd_por_embalagem  int NOT NULL DEFAULT 1 CHECK (qtd_por_embalagem >= 1),
  unidade_compra     text NOT NULL DEFAULT 'unidade',
  unit_cost_centavos int NOT NULL,
  pack_cost_centavos int,
  subtotal_centavos  int NOT NULL,
  leftover_units     int NOT NULL DEFAULT 0 CHECK (leftover_units >= 0),
  received_qty       int,
  received_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx
  ON public.purchase_order_items (purchase_order_id);

CREATE INDEX IF NOT EXISTS purchase_order_items_product_idx
  ON public.purchase_order_items (master_product_id);

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.purchase_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all purchase_requirements"
  ON public.purchase_requirements FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "admin all supplier_purchase_orders"
  ON public.supplier_purchase_orders FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "admin all purchase_order_items"
  ON public.purchase_order_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.purchase_requirements FROM anon;
REVOKE ALL ON public.supplier_purchase_orders FROM anon;
REVOKE ALL ON public.purchase_order_items FROM anon;

-- ============================================================================
-- 6. RPC: generate_purchase_order — gera PO a partir de requirements
-- ============================================================================
-- Lê condições de supplier_commercial_terms (criada em 0016).
-- Calcula embalagens (R3.4), mínimo (R4.3), frete (R1.1). Atômica.

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

  -- Condições comerciais ativas (0016)
  SELECT * INTO v_terms
  FROM public.supplier_commercial_terms
  WHERE supplier_id = p_supplier_id AND active = true AND valid_to IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor sem condições comerciais ativas.');
  END IF;

  -- Já existe PO para este ciclo?
  IF EXISTS (
    SELECT 1 FROM public.supplier_purchase_orders
    WHERE supplier_id = p_supplier_id AND cycle_date = p_cycle_date
      AND status NOT IN ('cancelled')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe pedido de compra para este ciclo.');
  END IF;

  -- Há requirements pendentes para este ciclo?
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_requirements
    WHERE supplier_id = p_supplier_id AND cycle_date = p_cycle_date AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma necessidade de compra pendente para este ciclo.');
  END IF;

  -- Criar PO
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

  -- Agregar requirements por produto
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

      -- R3.4: compra caixas inteiras, diferença é sobra
      IF v_emb > 1 THEN
        v_pack_count := CEIL(v_req.total_qty::numeric / v_emb);
        v_actual_units := v_pack_count * v_emb;
        v_leftover := v_actual_units - v_req.total_qty;
      ELSE
        v_pack_count := v_req.total_qty;
        v_actual_units := v_req.total_qty;
        v_leftover := 0;
      END IF;

      -- Custo: se tem pack_cost, usa packs × pack_cost; senão units × unit_cost
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

  -- Pedido mínimo (R4.3)
  IF v_terms.pedido_minimo_tipo = 'valor' AND v_terms.pedido_minimo IS NOT NULL THEN
    v_min_met := v_subtotal >= (v_terms.pedido_minimo * 100)::bigint;
  ELSE
    v_min_met := true;
  END IF;

  -- Expected delivery = cycle_date + prazo_entrega_cd_dias úteis
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

REVOKE ALL ON FUNCTION public.generate_purchase_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_purchase_order TO authenticated;

-- ============================================================================
-- 7. RPC: decide_minimum_shortfall — R4.3 decisão manual
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

  -- Se "esperar", libera requirements de volta para pending
  IF p_decision = 'wait_next_cycle' THEN
    UPDATE public.purchase_requirements
    SET status = 'pending', purchase_order_id = NULL
    WHERE purchase_order_id = p_purchase_order_id AND status = 'included';
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_minimum_shortfall FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_minimum_shortfall TO authenticated;

-- ============================================================================
-- 8. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.purchase_requirements IS
  'Necessidades de compra acumuladas por venda. Agrupadas por fornecedor×ciclo (R4.1).';

COMMENT ON TABLE public.supplier_purchase_orders IS
  'Pedidos de compra aos fornecedores. Um por fornecedor×ciclo. R4.3: minimum_not_met gera decisão manual.';

COMMENT ON TABLE public.purchase_order_items IS
  'Itens do PO com cálculo de embalagens (R3.4) e sobra (leftover_units).';

COMMENT ON COLUMN public.supplier_purchase_orders.decision IS
  'R4.3: complete_order (completar pedido), send_extra (enviar pagando diferença/frete), wait_next_cycle (esperar).';

COMMENT ON COLUMN public.purchase_order_items.leftover_units IS
  'R3.4: Unidades que sobram quando CCM compra caixas inteiras para atender avulso.';

COMMENT ON FUNCTION public.calculate_next_cycle_date IS
  'Próxima data de ciclo dado dias_pedido (int[] 0-6) e data de referência.';

COMMENT ON FUNCTION public.add_business_days IS
  'Soma dias úteis (seg-sex). LACUNA: feriados não definidos pelo documento.';

COMMENT ON FUNCTION public.calculate_expected_availability IS
  'R4.2: Data estimada = próximo ciclo + prazo_entrega_cd_dias úteis.';

COMMENT ON FUNCTION public.generate_purchase_order IS
  'Gera PO para fornecedor×ciclo. Calcula embalagens (R3.4), mínimo (R4.3), frete. Atômica.';

COMMENT ON FUNCTION public.decide_minimum_shortfall IS
  'R4.3: Decisão manual quando total < pedido_minimo.';
