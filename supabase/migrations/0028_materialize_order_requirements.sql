-- ============================================================================
-- CCM · Migration 0028 — R4.1b: Materializar vendas pagas → purchase_requirements
-- ============================================================================
--
-- Conecta o fluxo: pedido pago → itens elegíveis → purchase_requirements
-- no ciclo correto do fornecedor.
--
-- 1. Coluna de idempotência em order_items
-- 2. RPC materialize_order_requirements (service_role only)
--
-- Cancelamento/estorno: NÃO definido na spec Etapa 1 — lacuna documentada.
-- ============================================================================

-- ============================================================================
-- 1. COLUNA DE IDEMPOTÊNCIA
-- ============================================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS requirements_materialized_at timestamptz;

COMMENT ON COLUMN public.order_items.requirements_materialized_at IS
  'Timestamp de quando este item foi materializado em purchase_requirements. NULL = pendente.';

-- ============================================================================
-- 2. RPC: materialize_order_requirements
-- ============================================================================
-- Chamada pelo backend após confirmarPedidoPago().
-- Idempotente: processa apenas items com requirements_materialized_at IS NULL.
-- Acumula no requirement existente se (supplier, master, cycle, pending) coincidir.
-- Timezone: America/Sao_Paulo para calcular cycle_date com cutoff correto.

CREATE OR REPLACE FUNCTION public.materialize_order_requirements(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_status text;
  v_item           record;
  v_terms          record;
  v_cycle_date     date;
  v_now_sp         timestamp;
  v_today          date;
  v_hora           time;
  v_cutoff         time := '17:30'::time;
  v_from_date      date;
  v_existing_id    uuid;
  v_created        int := 0;
  v_accumulated    int := 0;
  v_skipped        int := 0;
BEGIN
  -- 1. Verificar pedido existe e está pago
  SELECT payment_status INTO v_payment_status
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.');
  END IF;

  IF v_payment_status <> 'pago' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está pago.');
  END IF;

  -- 2. Hora atual em São Paulo (cutoff + cycle calculation)
  v_now_sp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_today  := v_now_sp::date;
  v_hora   := v_now_sp::time;

  -- 3. Itens elegíveis: com snapshot de fornecedor, ainda não materializados
  FOR v_item IN
    SELECT
      oi.id                     AS item_id,
      oi.supplier_id,
      oi.supplier_offer_id,
      oi.master_product_id,
      oi.supplier_cost_centavos,
      oi.qty,
      so.cost_centavos          AS pack_cost,
      COALESCE(so.qtd_por_embalagem, 1)  AS qtd_por_embalagem,
      COALESCE(so.unidade_compra, 'unidade') AS unidade_compra
    FROM public.order_items oi
    LEFT JOIN public.supplier_offers so ON so.id = oi.supplier_offer_id
   WHERE oi.order_id = p_order_id
     AND oi.requirements_materialized_at IS NULL
     AND oi.supplier_id IS NOT NULL
     AND oi.master_product_id IS NOT NULL
   FOR UPDATE OF oi
  LOOP
    -- 4. Condições comerciais do fornecedor (dias_pedido)
    SELECT * INTO v_terms
      FROM public.supplier_commercial_terms
     WHERE supplier_id = v_item.supplier_id
       AND active = true
       AND valid_to IS NULL;

    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      -- Marcar como materializado mesmo sem terms (evita reprocessamento)
      UPDATE public.order_items
         SET requirements_materialized_at = now()
       WHERE id = v_item.item_id;
      CONTINUE;
    END IF;

    -- 5. Calcular cycle_date (respeita cutoff + dias_pedido)
    v_from_date := v_today;
    IF v_hora >= v_cutoff THEN
      v_from_date := v_today + 1;
    END IF;
    v_cycle_date := public.calculate_next_cycle_date(
      v_terms.dias_pedido, v_from_date
    );

    IF v_cycle_date IS NULL THEN
      v_skipped := v_skipped + 1;
      UPDATE public.order_items
         SET requirements_materialized_at = now()
       WHERE id = v_item.item_id;
      CONTINUE;
    END IF;

    -- 6. Acumular ou criar requirement
    SELECT id INTO v_existing_id
      FROM public.purchase_requirements
     WHERE supplier_id      = v_item.supplier_id
       AND master_product_id = v_item.master_product_id
       AND cycle_date        = v_cycle_date
       AND status            = 'pending'
     FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      -- Acumular no requirement existente
      UPDATE public.purchase_requirements
         SET quantity_units = quantity_units + v_item.qty
       WHERE id = v_existing_id;
      v_accumulated := v_accumulated + 1;
    ELSE
      -- Criar novo requirement
      INSERT INTO public.purchase_requirements (
        supplier_id, master_product_id,
        source_order_id, source_order_item_id,
        quantity_units, unit_cost_centavos, pack_cost_centavos,
        qtd_por_embalagem, unidade_compra,
        cycle_date, status
      ) VALUES (
        v_item.supplier_id,  v_item.master_product_id,
        p_order_id,          v_item.item_id,
        v_item.qty,          v_item.supplier_cost_centavos,  v_item.pack_cost,
        v_item.qtd_por_embalagem, v_item.unidade_compra,
        v_cycle_date,        'pending'
      );
      v_created := v_created + 1;
    END IF;

    -- 7. Marcar item como materializado (idempotência)
    UPDATE public.order_items
       SET requirements_materialized_at = now()
     WHERE id = v_item.item_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'created',     v_created,
    'accumulated', v_accumulated,
    'skipped',     v_skipped
  );
END;
$$;

-- Apenas service_role (backend) pode chamar
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.materialize_order_requirements(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.materialize_order_requirements(uuid) TO service_role;

COMMENT ON FUNCTION public.materialize_order_requirements IS
  'R4.1b: Materializa itens de pedido pago em purchase_requirements. '
  'Idempotente via requirements_materialized_at. Acumula se mesmo (supplier, product, cycle).';
