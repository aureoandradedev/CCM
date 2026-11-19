-- 0048: Partial order confirmation (item-by-item).
-- Compras can now confirm each item individually with quantity reduction/removal.
-- Stock is returned for the difference (qty - qty_confirmed).
-- Order totals are recalculated after partial confirmation.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. NEW COLUMNS on order_items for partial confirmation state
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS qty_confirmed int,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_reason text;

COMMENT ON COLUMN public.order_items.qty_confirmed IS 'Qty confirmed by Compras. NULL = pending, 0 = removed entirely.';
COMMENT ON COLUMN public.order_items.confirmed_by IS 'Profile that confirmed/removed this item.';
COMMENT ON COLUMN public.order_items.confirmed_at IS 'When this item was confirmed.';
COMMENT ON COLUMN public.order_items.removal_reason IS 'Why qty was reduced or item removed.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RPC: confirm_order_partial — item-by-item confirmation
-- ═══════════════════════════════════════════════════════════════════════════
-- p_items: jsonb array of {item_id, qty_confirmed, removal_reason?}
-- Every item in the order MUST be included in the array.
-- qty_confirmed must be 0..qty for each item.
-- Stock delta is returned to products.stock for reductions.
-- If ALL items set to 0, the order is cancelled via cancel_order_full.
-- Otherwise, totals are recalculated and order advances to next status.

CREATE OR REPLACE FUNCTION confirm_order_partial(
  p_order_id uuid,
  p_items    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  record;
  v_actor  uuid := auth.uid();
  v_item   record;
  v_decision record;
  v_decisions jsonb[];
  v_total_confirmed int := 0;
  v_new_subtotal bigint := 0;
  v_new_retail_subtotal bigint := 0;
  v_new_wholesale_savings bigint := 0;
  v_new_items_count int := 0;
  v_freight_centavos int := 0;
  v_freight_rule text;
  v_frete_config jsonb;
  v_free_from int;
  v_flat int;
  v_discount_centavos int := 0;
  v_new_total bigint;
  v_target text;
  v_stock_returned int := 0;
  v_items_in_order int;
  v_items_in_request int;
BEGIN
  -- RBAC: compras + admin only
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  -- Lock the order
  SELECT id, order_status, payment_method, delivery_method,
         discount_centavos, discount_detail, freight_rule,
         stock_reserved
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('error', 'Pedido não está aguardando confirmação.');
  END IF;

  -- Validate p_items is an array
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('error', 'Lista de itens inválida.');
  END IF;

  -- Count items in order and in request
  SELECT count(*) INTO v_items_in_order FROM order_items WHERE order_id = p_order_id;
  v_items_in_request := jsonb_array_length(p_items);

  IF v_items_in_request <> v_items_in_order THEN
    RETURN jsonb_build_object('error',
      format('Esperados %s itens, recebidos %s. Todos os itens devem ser incluídos.',
             v_items_in_order, v_items_in_request));
  END IF;

  -- Process each item decision
  FOR v_decision IN
    SELECT
      (x->>'item_id')::uuid AS item_id,
      (x->>'qty_confirmed')::int AS qty_confirmed,
      x->>'removal_reason' AS removal_reason
    FROM jsonb_array_elements(p_items) x
  LOOP
    -- Fetch and lock the item
    SELECT * INTO v_item
      FROM order_items
      WHERE id = v_decision.item_id AND order_id = p_order_id
      FOR UPDATE;

    IF v_item IS NULL THEN
      RETURN jsonb_build_object('error',
        format('Item %s não pertence a este pedido.', v_decision.item_id));
    END IF;

    -- Validate qty range
    IF v_decision.qty_confirmed IS NULL OR v_decision.qty_confirmed < 0 THEN
      RETURN jsonb_build_object('error',
        format('Quantidade confirmada inválida para item "%s".', v_item.name));
    END IF;

    IF v_decision.qty_confirmed > v_item.qty THEN
      RETURN jsonb_build_object('error',
        format('Quantidade confirmada (%s) maior que quantidade original (%s) para "%s".',
               v_decision.qty_confirmed, v_item.qty, v_item.name));
    END IF;

    -- Return stock for the reduction
    IF v_item.qty > v_decision.qty_confirmed AND v_order.stock_reserved THEN
      UPDATE products
        SET stock = stock + (v_item.qty - v_decision.qty_confirmed)
        WHERE id = v_item.product_id
          AND stock IS NOT NULL;
      v_stock_returned := v_stock_returned + (v_item.qty - v_decision.qty_confirmed);
    END IF;

    -- Update the item
    UPDATE order_items SET
      qty_confirmed  = v_decision.qty_confirmed,
      confirmed_by   = v_actor,
      confirmed_at   = now(),
      removal_reason = CASE
        WHEN v_decision.qty_confirmed < v_item.qty THEN COALESCE(v_decision.removal_reason, removal_reason)
        ELSE NULL
      END
    WHERE id = v_decision.item_id;

    -- Accumulate totals (only confirmed items count)
    IF v_decision.qty_confirmed > 0 THEN
      v_total_confirmed := v_total_confirmed + 1;
      v_new_subtotal := v_new_subtotal + (v_decision.qty_confirmed * v_item.unit_price_centavos);
      v_new_retail_subtotal := v_new_retail_subtotal + (v_decision.qty_confirmed * v_item.retail_price_centavos);
      v_new_items_count := v_new_items_count + v_decision.qty_confirmed;
    END IF;
  END LOOP;

  -- If ALL items removed → cancel order
  IF v_total_confirmed = 0 THEN
    -- Use cancel_order_full which handles all cleanup
    RETURN cancel_order_full(p_order_id);
  END IF;

  -- Calculate wholesale savings
  v_new_wholesale_savings := v_new_retail_subtotal - v_new_subtotal;
  IF v_new_wholesale_savings < 0 THEN v_new_wholesale_savings := 0; END IF;

  -- Recalculate freight from site_settings.frete
  IF v_order.delivery_method = 'pickup' THEN
    v_freight_centavos := 0;
    v_freight_rule := 'pickup';
  ELSE
    SELECT value INTO v_frete_config
      FROM site_settings WHERE key = 'frete';

    v_free_from := COALESCE((v_frete_config->>'freeShippingFromCentavos')::int, 79900);
    v_flat := COALESCE((v_frete_config->>'flatCentavos')::int, 4990);

    IF v_new_subtotal >= v_free_from THEN
      v_freight_centavos := 0;
      v_freight_rule := 'free-shipping';
    ELSE
      v_freight_centavos := v_flat;
      v_freight_rule := 'flat';
    END IF;
  END IF;

  -- Pix discount (recalculate only if original had discount)
  IF v_order.discount_centavos > 0 THEN
    -- Retrieve pix percentage from site_settings
    DECLARE
      v_descontos jsonb;
      v_pix_pct numeric;
    BEGIN
      SELECT value INTO v_descontos FROM site_settings WHERE key = 'descontos';
      v_pix_pct := COALESCE((v_descontos->>'pixPct')::numeric, 5);
      v_discount_centavos := ROUND((v_new_subtotal * v_pix_pct) / 100);
    END;
  END IF;

  -- Final total
  v_new_total := v_new_subtotal - v_discount_centavos + v_freight_centavos;
  IF v_new_total < 0 THEN v_new_total := 0; END IF;

  -- Determine target status
  IF v_order.payment_method = 'na-entrega' THEN
    v_target := 'em-separacao';
  ELSE
    v_target := 'aguardando-pagamento';
  END IF;

  -- Update order totals and status
  UPDATE orders SET
    order_status              = v_target,
    subtotal_centavos         = v_new_subtotal,
    retail_subtotal_centavos  = v_new_retail_subtotal,
    wholesale_savings_centavos = v_new_wholesale_savings,
    discount_centavos         = v_discount_centavos,
    freight_centavos          = v_freight_centavos,
    freight_rule              = v_freight_rule,
    total_centavos            = v_new_total,
    items_count               = v_new_items_count
  WHERE id = p_order_id;

  -- Update line_centavos on each confirmed item to reflect confirmed qty
  UPDATE order_items SET
    line_centavos = qty_confirmed * unit_price_centavos
  WHERE order_id = p_order_id AND qty_confirmed IS NOT NULL AND qty_confirmed > 0;

  -- Zero out line_centavos on removed items
  UPDATE order_items SET
    line_centavos = 0
  WHERE order_id = p_order_id AND qty_confirmed = 0;

  RETURN jsonb_build_object(
    'ok', true,
    'new_status', v_target,
    'items_confirmed', v_total_confirmed,
    'items_removed', v_items_in_order - v_total_confirmed,
    'stock_returned', v_stock_returned,
    'new_subtotal', v_new_subtotal,
    'new_freight', v_freight_centavos,
    'new_total', v_new_total
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill: mark all previously confirmed items (orders past aguardando-confirmacao)
-- ═══════════════════════════════════════════════════════════════════════════
-- For existing orders that were already confirmed (full confirm via old RPC),
-- set qty_confirmed = qty to maintain consistency.

UPDATE order_items oi SET
  qty_confirmed = oi.qty
FROM orders o
WHERE oi.order_id = o.id
  AND o.order_status <> 'aguardando-confirmacao'
  AND o.order_status <> 'cancelado'
  AND oi.qty_confirmed IS NULL;

COMMIT;
