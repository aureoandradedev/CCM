-- ============================================================================
-- 0053: Fix receiving → allocation flow
--
-- Problems fixed:
--   1. confirm_allocation_atomic ignores p_allocations (all stock → free inventory)
--   2. products.master_product_id never populated (structural gap)
--   3. No per-order-item tracking in inventory_movements
--   4. No shipment transition after allocation
--   5. Partial receiving across sessions not supported
-- ============================================================================

-- ============================================================================
-- 1. Add precise tracking columns to inventory_movements
-- ============================================================================

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_order_item_id uuid REFERENCES public.order_items(id),
  ADD COLUMN IF NOT EXISTS source_shipment_id   uuid REFERENCES public.order_shipments(id);

CREATE INDEX IF NOT EXISTS inventory_movements_order_item_idx
  ON public.inventory_movements (source_order_item_id)
  WHERE source_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_shipment_idx
  ON public.inventory_movements (source_shipment_id)
  WHERE source_shipment_id IS NOT NULL;

-- ============================================================================
-- 2. Backfill products.master_product_id from winning_offer_id
-- ============================================================================

DO $$
DECLARE
  v_updated_products int;
  v_null_products int;
BEGIN
  UPDATE products p
  SET master_product_id = so.master_product_id
  FROM supplier_offers so
  WHERE p.winning_offer_id = so.id
    AND so.master_product_id IS NOT NULL
    AND p.master_product_id IS NULL;

  GET DIAGNOSTICS v_updated_products = ROW_COUNT;

  SELECT count(*) INTO v_null_products
  FROM products
  WHERE master_product_id IS NULL;

  RAISE NOTICE 'Backfill products.master_product_id: % updated, % remain NULL (no winning_offer_id or offer has no master_product_id)',
    v_updated_products, v_null_products;
END;
$$;

-- ============================================================================
-- 3. Backfill order_items.master_product_id from products
-- ============================================================================

DO $$
DECLARE
  v_updated_items int;
  v_null_items int;
BEGIN
  UPDATE order_items oi
  SET master_product_id = p.master_product_id
  FROM products p
  WHERE oi.product_id = p.id
    AND p.master_product_id IS NOT NULL
    AND oi.master_product_id IS NULL;

  GET DIAGNOSTICS v_updated_items = ROW_COUNT;

  SELECT count(*) INTO v_null_items
  FROM order_items
  WHERE master_product_id IS NULL;

  RAISE NOTICE 'Backfill order_items.master_product_id: % updated, % remain NULL (product has no master_product_id)',
    v_updated_items, v_null_items;
END;
$$;

-- ============================================================================
-- 4. Rewrite confirm_allocation_atomic — 3 phases, real allocation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_allocation_atomic(
  p_session_id  uuid,
  p_allocations jsonb,
  p_actor_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         record;
  v_supplier_id     text;
  v_item            record;
  v_alloc           record;
  v_alloc_total     int;
  v_exc_id          uuid;
  v_shortage        int;
  v_order_item      record;
  v_remaining_need  int;
  v_prior_allocated int;
  v_current_stock   int;
  v_shipment_id     uuid;
  v_all_fulfilled   boolean;
  v_oi              record;
  v_oi_allocated    int;
  v_allocated_count int := 0;
  v_transitioned    text[] := '{}';
BEGIN
  -- ========================================================================
  -- GATE: Lock session, validate status, idempotency
  -- ========================================================================
  SELECT rs.id, rs.status, rs.purchase_order_id, rs.allocation_confirmed_at
  INTO v_session
  FROM receiving_sessions rs
  WHERE rs.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão de recebimento não encontrada.'
      USING HINT = 'NOT_FOUND';
  END IF;

  IF v_session.status != 'completed' THEN
    RAISE EXCEPTION 'Sessão não está completada (status: %).' , v_session.status
      USING HINT = 'BAD_STATUS';
  END IF;

  IF v_session.allocation_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Alocação já confirmada em %.' , v_session.allocation_confirmed_at
      USING HINT = 'ALREADY_CONFIRMED';
  END IF;

  -- ========================================================================
  -- VALIDATE: allocations don't exceed received stock per product
  -- ========================================================================
  FOR v_item IN (
    SELECT ri.master_product_id, ri.accepted_qty
    FROM receiving_items ri
    WHERE ri.receiving_session_id = p_session_id
  ) LOOP
    SELECT coalesce(sum((e->>'allocatedQty')::int), 0)
    INTO v_alloc_total
    FROM jsonb_array_elements(p_allocations) e
    WHERE (e->>'masterProductId')::uuid = v_item.master_product_id;

    IF v_alloc_total > v_item.accepted_qty THEN
      RAISE EXCEPTION 'Conflito: alocação de % excede estoque recebido de % para produto %.',
        v_alloc_total, v_item.accepted_qty, v_item.master_product_id
        USING HINT = 'STOCK_CONFLICT';
    END IF;
  END LOOP;

  -- ========================================================================
  -- PHASE A: Receipt — enter all accepted stock
  -- ========================================================================
  UPDATE receiving_sessions
  SET allocation_confirmed_at = now()
  WHERE id = p_session_id;

  FOR v_item IN (
    SELECT ri.master_product_id, ri.accepted_qty
    FROM receiving_items ri
    WHERE ri.receiving_session_id = p_session_id
      AND ri.accepted_qty > 0
  ) LOOP
    INSERT INTO ccm_inventory (master_product_id, quantity, last_movement_at)
    VALUES (v_item.master_product_id, v_item.accepted_qty, now())
    ON CONFLICT (master_product_id)
    DO UPDATE SET
      quantity = ccm_inventory.quantity + excluded.quantity,
      last_movement_at = now();

    INSERT INTO inventory_movements (
      master_product_id, movement_type, quantity,
      source_purchase_order_id, actor_id, reason
    ) VALUES (
      v_item.master_product_id, 'receipt', v_item.accepted_qty,
      v_session.purchase_order_id, p_actor_id,
      'Recebimento sessão ' || p_session_id::text
    );
  END LOOP;

  -- ========================================================================
  -- PHASE B: Allocations — reserve stock for orders
  -- ========================================================================
  FOR v_alloc IN (
    SELECT
      (e->>'orderItemId')::uuid   AS order_item_id,
      (e->>'shipmentId')::uuid    AS shipment_id,
      (e->>'orderId')::uuid       AS order_id,
      (e->>'masterProductId')::uuid AS master_product_id,
      (e->>'allocatedQty')::int   AS allocated_qty
    FROM jsonb_array_elements(p_allocations) e
    WHERE (e->>'allocatedQty')::int > 0
  ) LOOP
    -- Validate the order_item exists and matches stated fields
    SELECT oi.id, oi.qty, oi.order_id, oi.shipment_id, oi.master_product_id
    INTO v_order_item
    FROM order_items oi
    WHERE oi.id = v_alloc.order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item % não encontrado.',
        v_alloc.order_item_id
        USING HINT = 'INVALID_ALLOCATION';
    END IF;

    IF v_order_item.master_product_id != v_alloc.master_product_id THEN
      RAISE EXCEPTION 'master_product_id mismatch: order_item % tem %, allocation diz %.',
        v_alloc.order_item_id, v_order_item.master_product_id, v_alloc.master_product_id
        USING HINT = 'INVALID_ALLOCATION';
    END IF;

    IF v_order_item.shipment_id != v_alloc.shipment_id THEN
      RAISE EXCEPTION 'shipment_id mismatch: order_item % tem %, allocation diz %.',
        v_alloc.order_item_id, v_order_item.shipment_id, v_alloc.shipment_id
        USING HINT = 'INVALID_ALLOCATION';
    END IF;

    -- Calculate remaining need (supports partial across sessions)
    SELECT coalesce(sum(abs(im.quantity)), 0)
    INTO v_prior_allocated
    FROM inventory_movements im
    WHERE im.source_order_item_id = v_alloc.order_item_id
      AND im.movement_type = 'sale_from_stock';

    v_remaining_need := v_order_item.qty - v_prior_allocated;

    IF v_alloc.allocated_qty > v_remaining_need THEN
      RAISE EXCEPTION 'Over-allocation: order_item % precisa de % restantes, tentou alocar %.',
        v_alloc.order_item_id, v_remaining_need, v_alloc.allocated_qty
        USING HINT = 'OVER_ALLOCATION';
    END IF;

    -- Validate sufficient stock
    SELECT ci.quantity INTO v_current_stock
    FROM ccm_inventory ci
    WHERE ci.master_product_id = v_alloc.master_product_id
    FOR UPDATE;

    IF NOT FOUND OR v_current_stock < v_alloc.allocated_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para produto %: disponível=%, solicitado=%.',
        v_alloc.master_product_id, coalesce(v_current_stock, 0), v_alloc.allocated_qty
        USING HINT = 'STOCK_CONFLICT';
    END IF;

    -- Deduct from inventory
    UPDATE ccm_inventory
    SET quantity = quantity - v_alloc.allocated_qty,
        last_movement_at = now()
    WHERE master_product_id = v_alloc.master_product_id;

    -- Record allocation movement
    INSERT INTO inventory_movements (
      master_product_id, movement_type, quantity,
      source_order_id, source_order_item_id, source_shipment_id,
      source_purchase_order_id, actor_id, reason
    ) VALUES (
      v_alloc.master_product_id, 'sale_from_stock', -(v_alloc.allocated_qty),
      v_alloc.order_id, v_alloc.order_item_id, v_alloc.shipment_id,
      v_session.purchase_order_id, p_actor_id,
      'Alocação sessão ' || p_session_id::text
    );

    v_allocated_count := v_allocated_count + 1;
  END LOOP;

  -- ========================================================================
  -- PHASE C: Shipment transitions (consider ALL allocations, not just this session)
  -- ========================================================================
  FOR v_shipment_id IN (
    SELECT DISTINCT (e->>'shipmentId')::uuid
    FROM jsonb_array_elements(p_allocations) e
    WHERE (e->>'allocatedQty')::int > 0
  ) LOOP
    v_all_fulfilled := true;

    FOR v_oi IN (
      SELECT oi.id, oi.qty
      FROM order_items oi
      WHERE oi.shipment_id = v_shipment_id
    ) LOOP
      SELECT coalesce(sum(abs(im.quantity)), 0)
      INTO v_oi_allocated
      FROM inventory_movements im
      WHERE im.source_order_item_id = v_oi.id
        AND im.movement_type = 'sale_from_stock';

      IF v_oi_allocated < v_oi.qty THEN
        v_all_fulfilled := false;
        EXIT;
      END IF;
    END LOOP;

    IF v_all_fulfilled THEN
      UPDATE order_shipments
      SET status = 'preparando'
      WHERE id = v_shipment_id
        AND status = 'aguardando_disponibilidade';

      IF FOUND THEN
        v_transitioned := array_append(v_transitioned, v_shipment_id::text);
      END IF;
    END IF;
  END LOOP;

  -- ========================================================================
  -- PHASE D: Create exceptions for shortages and damages (unchanged)
  -- ========================================================================
  SELECT spo.supplier_id INTO v_supplier_id
  FROM supplier_purchase_orders spo
  WHERE spo.id = v_session.purchase_order_id;

  FOR v_item IN (
    SELECT ri.* FROM receiving_items ri WHERE ri.receiving_session_id = p_session_id
  ) LOOP
    IF v_item.expected_qty > v_item.received_qty THEN
      v_shortage := v_item.expected_qty - v_item.received_qty;

      INSERT INTO operational_exceptions (
        type, receiving_session_id, supplier_id, severity, created_by, details
      ) VALUES (
        'shortage', p_session_id, v_supplier_id,
        CASE WHEN v_shortage > v_item.expected_qty * 0.5 THEN 'high' ELSE 'medium' END,
        p_actor_id,
        jsonb_build_object('expected', v_item.expected_qty, 'received', v_item.received_qty, 'shortage', v_shortage)
      )
      RETURNING id INTO v_exc_id;

      INSERT INTO exception_links (exception_id, link_type, purchase_order_id)
      VALUES (v_exc_id, 'purchase_order', v_session.purchase_order_id);
      INSERT INTO exception_links (exception_id, link_type, product_id)
      VALUES (v_exc_id, 'product', v_item.master_product_id);
    END IF;

    IF v_item.damaged_qty > 0 THEN
      INSERT INTO operational_exceptions (
        type, receiving_session_id, supplier_id, severity, created_by, details
      ) VALUES (
        'damage', p_session_id, v_supplier_id,
        CASE WHEN v_item.damaged_qty > v_item.expected_qty * 0.3 THEN 'high' ELSE 'medium' END,
        p_actor_id,
        jsonb_build_object('damaged', v_item.damaged_qty, 'total_received', v_item.received_qty)
      )
      RETURNING id INTO v_exc_id;

      INSERT INTO exception_links (exception_id, link_type, purchase_order_id)
      VALUES (v_exc_id, 'purchase_order', v_session.purchase_order_id);
      INSERT INTO exception_links (exception_id, link_type, product_id)
      VALUES (v_exc_id, 'product', v_item.master_product_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', p_session_id,
    'inventoryUpdated', true,
    'allocationsApplied', v_allocated_count,
    'shipmentsTransitioned', to_jsonb(v_transitioned)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_allocation_atomic FROM public;
REVOKE ALL ON FUNCTION public.confirm_allocation_atomic FROM anon;
