-- 0065: CCM stock sale — atomic confirm + idempotency + race protection + per-reservation granularity
--
-- Corrections to Etapa 5 confirm_ccm_stock_sale:
--
--   1. RACE (pagamento × expiração):
--      Accepts optional p_paid_at (gateway timestamp).
--      When provided: rescues cron-expired locks where p_paid_at <= lock_expires_at.
--      When NULL (gateway has no timestamp): rescues locks expired within last 5 min.
--      Rescue re-checks inventory availability (FOR UPDATE) before promoting.
--
--   2. ATOMICITY:
--      Promote payment_lock → sold + INSERT inventory_movements in ONE transaction.
--      No separate Node calls for movements. Crash-safe: either both succeed or neither.
--
--   3. IDEMPOTENCY:
--      Unique partial index on source_reservation_id WHERE movement_type='sale_from_stock'.
--      Duplicate webhook / retry → exactly 1 movement per reservation. ON CONFLICT DO NOTHING.
--
--   4. GRANULARITY:
--      One inventory_movement per sold reservation (per order_item), not aggregated by product.
--      source_reservation_id links each movement to the specific reservation for full audit trail.
--
-- NOTE on ccm_inventory.quantity:
--   The view ccm_stock_available computes: disponivel = fisico - pagos - travados
--   where pagos = SUM(qty) of sold reservations. If we ALSO reduced ccm_inventory.quantity
--   here, it would double-count. Therefore, inventory_movements recorded by this function
--   do NOT reduce ccm_inventory.quantity — the 'pagos' in the view handles the deduction.
--   The movement row serves as an audit trail / ledger entry only.
--
-- LIMITATION — Gateway timestamp:
--   Cielo consultarPix() currently returns only { status } — no ReceivedDate/CapturedDate.
--   The mock gateway also does not expose payment timestamp.
--   Until the gateway integration extracts a reliable payment timestamp, the rescue mechanism
--   uses a 5-minute grace window as a fallback. This is safe because:
--     a) The Pix TTL is already capped 120s shorter than the lock TTL (getEffectivePixExpiration)
--     b) The 5-min grace covers any realistic webhook delivery delay
--   When a gateway timestamp becomes available, pass it as p_paid_at for exact comparison.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Add source_reservation_id to inventory_movements for per-item traceability
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_reservation_id uuid
  REFERENCES public.stock_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_reservation_idx
  ON public.inventory_movements (source_reservation_id)
  WHERE source_reservation_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Unique partial index: one sale_from_stock per reservation (idempotency)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_sale_per_reservation_uidx
  ON public.inventory_movements (source_reservation_id)
  WHERE movement_type = 'sale_from_stock' AND source_reservation_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Replace confirm_ccm_stock_sale — atomic, idempotent, race-safe
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_ccm_stock_sale(
  p_order_id uuid,
  p_paid_at  timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now              timestamptz := now();
  v_sold_count       int := 0;
  v_rescued_count    int := 0;
  v_rescue_failed    int := 0;
  v_released_count   int := 0;
  v_movements_count  int := 0;
  rec                record;
  v_available        int;
  v_fisico           int;
  v_committed        int;
BEGIN
  IF NOT is_ccm_stock_enabled() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ccm_stock_disabled');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1: Promote ACTIVE payment_locks → sold
  --         + create per-reservation inventory_movements (audit only)
  --         All in one atomic CTE chain.
  -- ═══════════════════════════════════════════════════════════════
  WITH promoted AS (
    UPDATE stock_reservations
    SET status = 'sold', sold_at = v_now
    WHERE order_id = p_order_id
      AND status = 'payment_lock'
      AND lock_expires_at > v_now
    RETURNING id, master_product_id, qty, order_item_id
  ),
  ins_movements AS (
    INSERT INTO inventory_movements (
      master_product_id, movement_type, quantity, unit_cost_centavos,
      source_order_id, source_reservation_id, reason
    )
    SELECT
      p.master_product_id,
      'sale_from_stock',
      -p.qty,
      inv.unit_cost_centavos,
      p_order_id,
      p.id,
      'ccm_direct_sale'
    FROM promoted p
    LEFT JOIN ccm_inventory inv ON inv.master_product_id = p.master_product_id
    ON CONFLICT (source_reservation_id)
      WHERE movement_type = 'sale_from_stock' AND source_reservation_id IS NOT NULL
      DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_sold_count FROM promoted;

  SELECT COUNT(*) INTO v_movements_count
  FROM inventory_movements
  WHERE source_order_id = p_order_id
    AND movement_type = 'sale_from_stock';

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2: Rescue expired-by-cron locks
  --
  -- When payment is confirmed but cron already expired the lock:
  --   - If p_paid_at is provided: rescue if p_paid_at <= lock_expires_at
  --   - If p_paid_at is NULL: rescue if lock expired within last 5 min
  --
  -- Each rescue re-checks inventory availability (FOR UPDATE on
  -- ccm_inventory) to prevent stealing stock from another order.
  -- ═══════════════════════════════════════════════════════════════
  FOR rec IN
    SELECT sr.id, sr.master_product_id, sr.qty, sr.order_item_id, sr.lock_expires_at
    FROM stock_reservations sr
    WHERE sr.order_id = p_order_id
      AND sr.status = 'released'
      AND sr.lock_expires_at IS NOT NULL
      AND (
        (p_paid_at IS NOT NULL AND p_paid_at <= sr.lock_expires_at)
        OR
        (p_paid_at IS NULL AND sr.lock_expires_at > v_now - INTERVAL '5 minutes')
      )
    ORDER BY sr.master_product_id
    FOR UPDATE
  LOOP
    -- Lock inventory row and calculate real availability
    SELECT ci.quantity INTO v_fisico
    FROM ccm_inventory ci
    WHERE ci.master_product_id = rec.master_product_id
    FOR UPDATE;

    IF v_fisico IS NULL THEN
      v_fisico := 0;
    END IF;

    SELECT COALESCE(SUM(r.qty), 0) INTO v_committed
    FROM stock_reservations r
    WHERE r.master_product_id = rec.master_product_id
      AND r.id <> rec.id
      AND (
        r.status = 'sold'
        OR (r.status = 'payment_lock' AND r.lock_expires_at > v_now)
      );

    v_available := GREATEST(v_fisico - v_committed, 0);

    IF v_available >= rec.qty THEN
      -- Rescue: promote back to sold
      UPDATE stock_reservations
      SET status = 'sold', sold_at = v_now
      WHERE id = rec.id;

      -- Insert audit movement (idempotent)
      INSERT INTO inventory_movements (
        master_product_id, movement_type, quantity, unit_cost_centavos,
        source_order_id, source_reservation_id, reason
      )
      SELECT
        rec.master_product_id,
        'sale_from_stock',
        -rec.qty,
        inv.unit_cost_centavos,
        p_order_id,
        rec.id,
        'ccm_direct_sale_rescued'
      FROM ccm_inventory inv
      WHERE inv.master_product_id = rec.master_product_id
      ON CONFLICT (source_reservation_id)
        WHERE movement_type = 'sale_from_stock' AND source_reservation_id IS NOT NULL
        DO NOTHING;

      v_rescued_count := v_rescued_count + 1;
    ELSE
      v_rescue_failed := v_rescue_failed + 1;
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3: Release remaining reservations and expired locks
  -- ═══════════════════════════════════════════════════════════════
  UPDATE stock_reservations
  SET status = 'released', released_at = v_now
  WHERE order_id = p_order_id
    AND status IN ('reservation', 'payment_lock');
  GET DIAGNOSTICS v_released_count = ROW_COUNT;

  -- Recount movements (includes rescued ones)
  SELECT COUNT(*) INTO v_movements_count
  FROM inventory_movements
  WHERE source_order_id = p_order_id
    AND movement_type = 'sale_from_stock';

  RETURN jsonb_build_object(
    'ok', true,
    'sold_count', v_sold_count + v_rescued_count,
    'rescued_count', v_rescued_count,
    'rescue_failed', v_rescue_failed,
    'released_count', v_released_count,
    'movements_count', v_movements_count
  );
END;
$$;

COMMIT;
