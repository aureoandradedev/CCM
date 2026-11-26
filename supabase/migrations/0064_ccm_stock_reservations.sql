-- 0064: CCM Stock Reservations — Bloco 1 V2
--
-- stock_reservations table: lifecycle reservation → payment_lock → sold/released
-- 5 RPCs: reserve, lock_for_payment, confirm_sale, release, expire
-- pg_cron job: expire payment locks every minute
-- ccm_stock_available view: disponivel = fisico - pagos - travados_ativos
-- Feature flag: ccm_stock_enabled in ccm_configs
-- Invariants enforced:
--   (a) disponivel = fisico - pagos - somaTravasAtivas (reserva NÃO diminui)
--   (b) sum of active payment_locks per product ≤ physical stock
--   (c) only locked qty can become sold
--   (d) all operations idempotent

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. pg_cron extension
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. stock_reservations table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id     uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  qty               int NOT NULL CHECK (qty > 0),
  status            text NOT NULL DEFAULT 'reservation'
                    CHECK (status IN ('reservation', 'payment_lock', 'sold', 'released')),
  locked_at         timestamptz,
  lock_expires_at   timestamptz,
  sold_at           timestamptz,
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_reservations_order ON public.stock_reservations (order_id);
CREATE INDEX idx_stock_reservations_product_status ON public.stock_reservations (master_product_id, status);
CREATE INDEX idx_stock_reservations_expires ON public.stock_reservations (lock_expires_at)
  WHERE status = 'payment_lock';

CREATE TRIGGER set_updated_at_stock_reservations
  BEFORE UPDATE ON public.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Feature flag + config in ccm_configs
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.ccm_configs (key, scope, value)
VALUES
  ('ccm_stock_enabled', 'global', 'false'::jsonb),
  ('payment_lock_ttl_minutes', 'global', '15'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Helper: is_ccm_stock_enabled()
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_ccm_stock_enabled()
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value)::text::boolean
     FROM ccm_configs
     WHERE key = 'ccm_stock_enabled' AND scope = 'global'
     LIMIT 1),
    false
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Helper: get_payment_lock_ttl_minutes()
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_payment_lock_ttl_minutes()
RETURNS int
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::int
     FROM ccm_configs
     WHERE key = 'payment_lock_ttl_minutes' AND scope = 'global'
     LIMIT 1),
    15
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. View: ccm_stock_available
--    disponivel = fisico - pagos - somaTravasAtivas
--    pagos   = sum(qty) WHERE status = 'sold'
--    travas  = sum(qty) WHERE status = 'payment_lock' AND lock_expires_at > now()
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ccm_stock_available AS
SELECT
  ci.master_product_id,
  ci.quantity AS fisico,
  COALESCE(agg.pagos, 0) AS pagos,
  COALESCE(agg.travados, 0) AS travados,
  ci.quantity - COALESCE(agg.pagos, 0) - COALESCE(agg.travados, 0) AS disponivel
FROM public.ccm_inventory ci
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN sr.status = 'sold' THEN sr.qty ELSE 0 END) AS pagos,
    SUM(CASE WHEN sr.status = 'payment_lock' AND sr.lock_expires_at > now()
             THEN sr.qty ELSE 0 END) AS travados
  FROM public.stock_reservations sr
  WHERE sr.master_product_id = ci.master_product_id
    AND sr.status IN ('sold', 'payment_lock')
) agg ON true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RPC: reserve_ccm_stock(p_order_id, p_items)
--    Creates reservation rows for CCM-stocked items at checkout.
--    p_items: jsonb array [{order_item_id, master_product_id, qty}]
--    Reservation does NOT reduce availability.
--    Idempotent: skips if reservations already exist for the order.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reserve_ccm_stock(
  p_order_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_count int := 0;
BEGIN
  IF NOT is_ccm_stock_enabled() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ccm_stock_disabled');
  END IF;

  -- Idempotent: if reservations already exist for this order, return early
  IF EXISTS (SELECT 1 FROM stock_reservations WHERE order_id = p_order_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_reserved');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO stock_reservations (order_id, order_item_id, master_product_id, qty, status)
    VALUES (
      p_order_id,
      (v_item->>'order_item_id')::uuid,
      (v_item->>'master_product_id')::uuid,
      (v_item->>'qty')::int,
      'reservation'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reserved_count', v_count);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RPC: lock_ccm_stock_for_payment(p_order_id)
--    Atomically promotes reservation → payment_lock for items with
--    available CCM stock. If CCM stock dropped since reservation,
--    the shortage stays as reservation (enters supplier flow).
--    Returns {travado, faltou} per item.
--
--    Invariant (b): sum(active locks per product) ≤ physical stock
--    Locks ccm_inventory rows FOR UPDATE to serialize.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.lock_ccm_stock_for_payment(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl int;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_rec record;
  v_fisico int;
  v_pagos int;
  v_travados int;
  v_disponivel int;
  v_trava int;
  v_results jsonb := '[]'::jsonb;
  v_total_travado int := 0;
  v_total_faltou int := 0;
BEGIN
  IF NOT is_ccm_stock_enabled() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ccm_stock_disabled');
  END IF;

  v_ttl := get_payment_lock_ttl_minutes();
  v_expires := v_now + (v_ttl || ' minutes')::interval;

  -- Idempotent: if already locked for this order, return current state
  IF EXISTS (
    SELECT 1 FROM stock_reservations
    WHERE order_id = p_order_id AND status = 'payment_lock'
    LIMIT 1
  ) THEN
    SELECT
      SUM(qty) FILTER (WHERE status = 'payment_lock' AND lock_expires_at > v_now),
      SUM(qty) FILTER (WHERE status = 'reservation')
    INTO v_total_travado, v_total_faltou
    FROM stock_reservations
    WHERE order_id = p_order_id AND status IN ('payment_lock', 'reservation');

    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_locked',
      'travado', COALESCE(v_total_travado, 0),
      'faltou', COALESCE(v_total_faltou, 0)
    );
  END IF;

  -- First: expire stale locks globally (lazy cleanup)
  UPDATE stock_reservations
  SET status = 'released', released_at = v_now
  WHERE status = 'payment_lock' AND lock_expires_at <= v_now;

  -- Process each reservation for this order, locking inventory rows in
  -- master_product_id order to prevent deadlocks
  FOR v_rec IN
    SELECT sr.id, sr.master_product_id, sr.qty
    FROM stock_reservations sr
    WHERE sr.order_id = p_order_id AND sr.status = 'reservation'
    ORDER BY sr.master_product_id
  LOOP
    -- Lock the inventory row
    SELECT ci.quantity INTO v_fisico
    FROM ccm_inventory ci
    WHERE ci.master_product_id = v_rec.master_product_id
    FOR UPDATE;

    IF v_fisico IS NULL THEN
      v_fisico := 0;
    END IF;

    -- Calculate current commitments for this product
    SELECT
      COALESCE(SUM(qty) FILTER (WHERE status = 'sold'), 0),
      COALESCE(SUM(qty) FILTER (WHERE status = 'payment_lock' AND lock_expires_at > v_now), 0)
    INTO v_pagos, v_travados
    FROM stock_reservations
    WHERE master_product_id = v_rec.master_product_id
      AND id <> v_rec.id;

    -- disponivel = fisico - pagos - travados
    v_disponivel := GREATEST(v_fisico - v_pagos - v_travados, 0);
    v_trava := LEAST(v_rec.qty, v_disponivel);

    IF v_trava > 0 THEN
      -- Split: if partial, create a new reservation row for the remainder
      IF v_trava < v_rec.qty THEN
        INSERT INTO stock_reservations (
          order_id, order_item_id, master_product_id, qty, status
        )
        SELECT order_id, order_item_id, master_product_id, v_rec.qty - v_trava, 'reservation'
        FROM stock_reservations WHERE id = v_rec.id;

        UPDATE stock_reservations
        SET qty = v_trava,
            status = 'payment_lock',
            locked_at = v_now,
            lock_expires_at = v_expires
        WHERE id = v_rec.id;
      ELSE
        UPDATE stock_reservations
        SET status = 'payment_lock',
            locked_at = v_now,
            lock_expires_at = v_expires
        WHERE id = v_rec.id;
      END IF;

      v_total_travado := v_total_travado + v_trava;
    END IF;

    IF v_trava < v_rec.qty THEN
      v_total_faltou := v_total_faltou + (v_rec.qty - v_trava);
    END IF;

    v_results := v_results || jsonb_build_object(
      'master_product_id', v_rec.master_product_id,
      'solicitado', v_rec.qty,
      'travado', v_trava,
      'faltou', v_rec.qty - v_trava
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'travado', v_total_travado,
    'faltou', v_total_faltou,
    'expires_at', v_expires,
    'details', v_results
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. RPC: confirm_ccm_stock_sale(p_order_id)
--    Promotes payment_lock → sold after payment confirmed.
--    Invariant (c): only locked qty can become sold.
--    Remaining reservations (supplier flow items) are released.
--    Idempotent: safe to call multiple times.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_ccm_stock_sale(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_sold_count int := 0;
  v_released_count int := 0;
BEGIN
  IF NOT is_ccm_stock_enabled() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ccm_stock_disabled');
  END IF;

  -- Promote active locks to sold
  UPDATE stock_reservations
  SET status = 'sold', sold_at = v_now
  WHERE order_id = p_order_id
    AND status = 'payment_lock'
    AND lock_expires_at > v_now;
  GET DIAGNOSTICS v_sold_count = ROW_COUNT;

  -- Release any remaining reservations (supplier-flow items or expired locks)
  UPDATE stock_reservations
  SET status = 'released', released_at = v_now
  WHERE order_id = p_order_id
    AND status IN ('reservation', 'payment_lock');
  GET DIAGNOSTICS v_released_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'sold_count', v_sold_count,
    'released_count', v_released_count
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RPC: release_ccm_stock(p_order_id)
--    Releases all non-sold reservations for an order (cancel flow).
--    Sold items stay sold (physical stock already committed).
--    Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_ccm_stock(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_released int := 0;
BEGIN
  IF NOT is_ccm_stock_enabled() THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'ccm_stock_disabled');
  END IF;

  UPDATE stock_reservations
  SET status = 'released', released_at = v_now
  WHERE order_id = p_order_id
    AND status IN ('reservation', 'payment_lock');
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'released_count', v_released);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. RPC: expire_payment_locks()
--     Called by pg_cron every minute. Releases expired payment_lock rows.
--     This is the primary expiration mechanism.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expire_payment_locks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_expired int := 0;
BEGIN
  UPDATE stock_reservations
  SET status = 'released', released_at = v_now
  WHERE status = 'payment_lock' AND lock_expires_at <= v_now;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'expired_count', v_expired);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. pg_cron job: expire payment locks every minute
-- ═══════════════════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'expire-payment-locks',
  '* * * * *',
  $$SELECT public.expire_payment_locks()$$
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. RLS policies for stock_reservations
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all stock_reservations"
  ON public.stock_reservations FOR ALL
  USING (public.is_admin());

CREATE POLICY "compras reads stock_reservations"
  ON public.stock_reservations FOR SELECT
  USING (public.has_role(ARRAY['compras']));

COMMIT;
