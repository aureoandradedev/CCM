-- 0066: RPC for customer-facing CCM order display classification.
--
-- Returns a JSON object describing the CCM fulfillment status of an order,
-- used by the frontend to:
--   - Skip the "supplier confirmation" timeline step for 100% CCM orders
--   - Show per-item availability (Disponível / Em confirmação / split)
--   - Display adjustment messages after shortfall
--
-- SECURITY DEFINER: reads stock_reservations, order_events, ccm_configs
-- which customers cannot access directly via RLS.
-- Ownership verified: auth.uid() must match orders.profile_id.
-- Short-circuits when ccm_stock_enabled = false (zero overhead).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_ccm_display(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id    uuid;
  v_enabled       boolean;
  v_total_items   int := 0;
  v_ccm_items     int := 0;
  v_all_ccm_full  int := 0;
  v_has_ccm       boolean := false;
  v_shortfall     boolean := false;
  v_items         jsonb := '[]'::jsonb;
BEGIN
  -- 1. Verify ownership
  SELECT profile_id INTO v_profile_id
  FROM orders WHERE id = p_order_id;

  IF v_profile_id IS NULL OR v_profile_id <> auth.uid() THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  -- 2. Check flag (early exit when OFF)
  v_enabled := is_ccm_stock_enabled();
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  -- 3. Build per-item classification
  --    ccmQty = sum of sold reservation qty per order_item
  --    supplierQty = total qty - ccmQty
  SELECT
    jsonb_agg(row_data),
    COUNT(*),
    COUNT(*) FILTER (WHERE ccm_qty > 0),
    COUNT(*) FILTER (WHERE ccm_qty >= total_qty AND ccm_qty > 0)
  INTO v_items, v_total_items, v_ccm_items, v_all_ccm_full
  FROM (
    SELECT
      jsonb_build_object(
        'orderItemId', oi.id,
        'ccmQty', COALESCE(SUM(CASE WHEN sr.status = 'sold' THEN sr.qty ELSE 0 END), 0),
        'supplierQty', oi.qty - COALESCE(SUM(CASE WHEN sr.status = 'sold' THEN sr.qty ELSE 0 END), 0),
        'totalQty', oi.qty
      ) AS row_data,
      COALESCE(SUM(CASE WHEN sr.status = 'sold' THEN sr.qty ELSE 0 END), 0) AS ccm_qty,
      oi.qty AS total_qty
    FROM order_items oi
    LEFT JOIN stock_reservations sr
      ON sr.order_item_id = oi.id AND sr.order_id = p_order_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.id, oi.qty
  ) sub;

  v_has_ccm := v_ccm_items > 0;

  -- 4. Check for shortfall event
  SELECT EXISTS(
    SELECT 1 FROM order_events
    WHERE order_id = p_order_id AND event_type = 'ccm_shortfall'
  ) INTO v_shortfall;

  RETURN jsonb_build_object(
    'enabled', true,
    'hasCcm', v_has_ccm,
    'isCcmOnly', v_has_ccm AND v_all_ccm_full = v_total_items,
    'hasShortfall', v_shortfall,
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

COMMIT;
