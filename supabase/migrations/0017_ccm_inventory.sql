-- ============================================================================
-- CCM · Migration 0017 — Estoque próprio CCM e movimentos de inventário
-- ============================================================================
-- Fase 13 do documento CCM_Estrutura_Operacao_TI.docx
--
-- Novas tabelas:
--   ccm_inventory          — estoque físico CCM por master_product
--   inventory_movements    — log de movimentos (receipt, leftover, sale, adjustment, etc.)
--
-- R3.4: Quando o cliente compra unidades avulsas, a CCM compra caixas inteiras.
--       A diferença entra como sobra no estoque da CCM.
-- R3.3: Teto de valor parado em sobra [config] — leftover_ceiling_centavos
--
-- RPCs:
--   record_inventory_movement  — genérico, atômico
--   record_leftover            — sobra de compra (purchase_leftover)
--   consume_leftover           — venda de estoque (sale_from_stock)
--
-- Funções:
--   calculate_leftover_total_value — soma total de sobras para validação de teto
--
-- View:
--   v_leftover_summary — resumo de estoque com teto
-- ============================================================================

-- ============================================================================
-- 1. CCM_INVENTORY — estoque físico CCM
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ccm_inventory (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  quantity           int NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost_centavos int,
  total_value_centavos int GENERATED ALWAYS AS (quantity * COALESCE(unit_cost_centavos, 0)) STORED,
  last_movement_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ccm_inventory_product_unique_idx
  ON public.ccm_inventory (master_product_id);

CREATE TRIGGER set_updated_at_ccm_inventory
  BEFORE UPDATE ON public.ccm_inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. INVENTORY_MOVEMENTS — log de todos os movimentos
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id        uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  movement_type            text NOT NULL
                           CHECK (movement_type IN (
                             'receipt', 'leftover', 'purchase_leftover',
                             'sale', 'sale_from_stock',
                             'adjustment', 'return', 'write_off'
                           )),
  quantity                 int NOT NULL,
  unit_cost_centavos       int,
  source_supplier_id       text REFERENCES public.suppliers(id),
  source_purchase_order_id uuid,
  source_order_id          uuid,
  reason                   text,
  actor_id                 uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_product_idx
  ON public.inventory_movements (master_product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_movements_type_idx
  ON public.inventory_movements (movement_type, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_movements_supplier_idx
  ON public.inventory_movements (source_supplier_id)
  WHERE source_supplier_id IS NOT NULL;

-- ============================================================================
-- 3. RPC: record_inventory_movement — genérico, atômico
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_master_product_id      uuid,
  p_movement_type          text,
  p_quantity               int,
  p_unit_cost_centavos     int DEFAULT NULL,
  p_source_supplier_id     text DEFAULT NULL,
  p_source_purchase_order_id uuid DEFAULT NULL,
  p_source_order_id        uuid DEFAULT NULL,
  p_reason                 text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_inv   public.ccm_inventory;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  IF p_movement_type NOT IN (
    'receipt', 'leftover', 'purchase_leftover',
    'sale', 'sale_from_stock',
    'adjustment', 'return', 'write_off'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de movimento inválido.');
  END IF;

  IF p_quantity = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quantidade não pode ser zero.');
  END IF;

  INSERT INTO public.ccm_inventory (master_product_id, quantity, unit_cost_centavos)
  VALUES (p_master_product_id, 0, p_unit_cost_centavos)
  ON CONFLICT (master_product_id) DO NOTHING;

  UPDATE public.ccm_inventory
  SET quantity = GREATEST(0, quantity + p_quantity),
      unit_cost_centavos = COALESCE(p_unit_cost_centavos, unit_cost_centavos),
      last_movement_at = now()
  WHERE master_product_id = p_master_product_id
  RETURNING * INTO v_inv;

  INSERT INTO public.inventory_movements (
    master_product_id, movement_type, quantity, unit_cost_centavos,
    source_supplier_id, source_purchase_order_id, source_order_id,
    reason, actor_id
  ) VALUES (
    p_master_product_id, p_movement_type, p_quantity, p_unit_cost_centavos,
    p_source_supplier_id, p_source_purchase_order_id, p_source_order_id,
    p_reason, v_actor
  );

  RETURN jsonb_build_object(
    'ok', true,
    'new_quantity', v_inv.quantity,
    'total_value_centavos', v_inv.total_value_centavos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_inventory_movement FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement TO authenticated;

-- ============================================================================
-- 4. RPC: record_leftover — sobra de compra (R3.4)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_leftover(
  p_master_product_id        uuid,
  p_quantity                 int,
  p_unit_cost_centavos       int,
  p_source_supplier_id       text DEFAULT NULL,
  p_source_purchase_order_id uuid DEFAULT NULL,
  p_note                     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_inv      record;
  v_new_qty  int;
  v_new_cost int;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('error', 'Quantidade deve ser positiva.');
  END IF;

  INSERT INTO inventory_movements (
    master_product_id, movement_type, quantity, unit_cost_centavos,
    source_supplier_id, source_purchase_order_id, reason, actor_id
  ) VALUES (
    p_master_product_id, 'purchase_leftover', p_quantity, p_unit_cost_centavos,
    p_source_supplier_id, p_source_purchase_order_id, p_note, v_admin_id
  );

  SELECT quantity, unit_cost_centavos INTO v_inv
    FROM ccm_inventory WHERE master_product_id = p_master_product_id;

  IF v_inv IS NULL THEN
    INSERT INTO ccm_inventory (master_product_id, quantity, unit_cost_centavos)
    VALUES (p_master_product_id, p_quantity, p_unit_cost_centavos);
  ELSE
    v_new_qty := v_inv.quantity + p_quantity;
    IF v_new_qty > 0 THEN
      v_new_cost := ((v_inv.quantity * v_inv.unit_cost_centavos) + (p_quantity * p_unit_cost_centavos)) / v_new_qty;
    ELSE
      v_new_cost := p_unit_cost_centavos;
    END IF;
    UPDATE ccm_inventory
       SET quantity = v_new_qty, unit_cost_centavos = v_new_cost
     WHERE master_product_id = p_master_product_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_quantity', COALESCE(v_new_qty, p_quantity));
END;
$$;

REVOKE ALL ON FUNCTION public.record_leftover FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_leftover FROM anon;
GRANT EXECUTE ON FUNCTION public.record_leftover TO authenticated;

-- ============================================================================
-- 5. RPC: consume_leftover — venda do estoque CCM
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consume_leftover(
  p_master_product_id  uuid,
  p_quantity           int,
  p_reason             text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_inv      record;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('error', 'Quantidade deve ser positiva.');
  END IF;

  SELECT quantity, unit_cost_centavos INTO v_inv
    FROM ccm_inventory WHERE master_product_id = p_master_product_id
    FOR UPDATE;

  IF v_inv IS NULL OR v_inv.quantity < p_quantity THEN
    RETURN jsonb_build_object('error', 'Estoque insuficiente.',
      'available', COALESCE(v_inv.quantity, 0));
  END IF;

  INSERT INTO inventory_movements (
    master_product_id, movement_type, quantity, unit_cost_centavos,
    reason, actor_id
  ) VALUES (
    p_master_product_id, 'sale_from_stock', -p_quantity, v_inv.unit_cost_centavos,
    p_reason, v_admin_id
  );

  UPDATE ccm_inventory
     SET quantity = quantity - p_quantity
   WHERE master_product_id = p_master_product_id;

  RETURN jsonb_build_object('ok', true, 'remaining', v_inv.quantity - p_quantity);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_leftover FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_leftover FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_leftover TO authenticated;

-- ============================================================================
-- 6. FUNÇÃO: calculate_leftover_total_value — para validar teto de sobra
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_leftover_total_value()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(total_value_centavos), 0)::bigint
  FROM public.ccm_inventory
  WHERE quantity > 0;
$$;

-- ============================================================================
-- 7. VIEW: v_leftover_summary — resumo de estoque com teto
-- ============================================================================

CREATE OR REPLACE VIEW public.v_leftover_summary AS
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

-- ============================================================================
-- 8. RLS
-- ============================================================================

ALTER TABLE public.ccm_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all ccm_inventory"
  ON public.ccm_inventory FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.ccm_inventory FROM anon;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read inventory_movements"
  ON public.inventory_movements FOR SELECT
  USING (public.is_admin());

CREATE POLICY "admin insert inventory_movements"
  ON public.inventory_movements FOR INSERT
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.inventory_movements FROM anon;

-- ============================================================================
-- 9. COMENTÁRIOS
-- ============================================================================

COMMENT ON TABLE public.ccm_inventory IS
  'Estoque físico da CCM por produto mestre. Separado de products.stock (vendável ao cliente). Inclui sobras de embalagens.';
COMMENT ON COLUMN public.ccm_inventory.total_value_centavos IS
  'Valor total parado = quantity × unit_cost_centavos. Gerado. Usado para R3.3 (teto de sobra).';
COMMENT ON TABLE public.inventory_movements IS
  'Log imutável de movimentações de estoque CCM. Tipos: receipt (recebimento de PO), purchase_leftover (sobra de caixa), sale_from_stock (venda de estoque próprio), adjustment (ajuste manual), write_off (baixa), return (devolução).';
COMMENT ON FUNCTION public.record_inventory_movement IS
  'Registra movimento de estoque atomicamente (log + atualiza ccm_inventory). Quantidade positiva = entrada, negativa = saída.';
COMMENT ON FUNCTION public.record_leftover IS
  'Registra sobra de compra no estoque CCM. Custo médio ponderado. Atômica. R3.4.';
COMMENT ON FUNCTION public.consume_leftover IS
  'Consome sobra do estoque CCM (venda). Verifica disponibilidade. Atômica.';
