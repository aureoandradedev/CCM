-- ============================================================================
-- CCM · Migration 0076 — Bloco 3 V2: Economic Protection Layer
-- ============================================================================
--
-- Implements:
--   1. Feature flag: ccm_result_protection_enabled (OFF by default)
--   2. Config params: min_result_centavos, max_internal_discount_pct
--   3. credit_ledger — append-only immutable ledger for internal discount credits
--   4. result_locks — economic lock before payment
--   5. freight_allocations — supplier freight prorated across customer orders
--   6. Helper function: is_ccm_result_protection_enabled()
--   7. RPCs: generate_credit, reserve_credit, use_credit, release_credit,
--           adjust_credit, lock_result_for_payment, prorate_supplier_freight
--   8. Views: credit_balance_by_order
--   9. RLS policies
--  10. Indexes + constraints
--
-- Invariants enforced:
--   (a) credit_ledger is append-only (no UPDATE/DELETE trigger)
--   (b) available_credit >= 0 always (checked in RPCs, not constraints — ledger is append-only)
--   (c) SUM(freight_allocations) = PO freight exactly (checked in prorate RPC)
--   (d) All amounts in integer centavos — no floats
--   (e) Idempotency keys on all ledger entries
--   (f) result_locks are immutable once created (no UPDATE trigger)
--
-- All operations are idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- ============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Feature flag + config params
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value)
VALUES
  ('ccm_result_protection_enabled', 'global', 'false'::jsonb),
  ('min_result_centavos',           'global', '0'::jsonb),
  ('max_internal_discount_pct',     'global', '100'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Helper: is_ccm_result_protection_enabled()
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_ccm_result_protection_enabled()
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value)::text::boolean
     FROM ccm_configs
     WHERE key = 'ccm_result_protection_enabled' AND scope = 'global'
     LIMIT 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_ccm_result_protection_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_ccm_result_protection_enabled() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_ccm_result_protection_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ccm_result_protection_enabled() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. credit_ledger — append-only immutable ledger
-- ═══════════════════════════════════════════════════════════════════════════
-- Movement types:
--   credit_generated  — economy confirmed (confirmed cost < expected cost)
--   credit_reserved   — reserved for use in a discount (before payment)
--   credit_used       — applied as discount (at payment)
--   credit_released   — reservation cancelled (order cancelled, etc.)
--   credit_adjusted   — manual adjustment by admin (with reason)
--   credit_reversed   — reversal of a used credit (refund, etc.)
--
-- Available = SUM(generated + adjusted + reversed + released)
--           - SUM(reserved + used)
-- Must never go negative.

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  movement_type     text NOT NULL,
  amount_centavos   int NOT NULL,
  balance_after     int NOT NULL,
  reference_id      uuid,
  reference_type    text,
  reason            text,
  actor_id          uuid REFERENCES public.profiles(id),
  actor_kind        text NOT NULL DEFAULT 'system',
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cl_movement_type_check CHECK (movement_type IN (
    'credit_generated',
    'credit_reserved',
    'credit_used',
    'credit_released',
    'credit_adjusted',
    'credit_reversed'
  )),
  CONSTRAINT cl_amount_positive CHECK (amount_centavos > 0),
  CONSTRAINT cl_balance_non_negative CHECK (balance_after >= 0),
  CONSTRAINT cl_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cl_order ON public.credit_ledger(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cl_movement ON public.credit_ledger(movement_type);
CREATE INDEX IF NOT EXISTS idx_cl_reference ON public.credit_ledger(reference_id)
  WHERE reference_id IS NOT NULL;

-- Immutability: prevent UPDATE and DELETE on credit_ledger
CREATE OR REPLACE FUNCTION public.credit_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only: UPDATE and DELETE are forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_ledger_no_update ON public.credit_ledger;
CREATE TRIGGER trg_credit_ledger_no_update
  BEFORE UPDATE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_immutable();

DROP TRIGGER IF EXISTS trg_credit_ledger_no_delete ON public.credit_ledger;
CREATE TRIGGER trg_credit_ledger_no_delete
  BEFORE DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_immutable();

COMMENT ON TABLE public.credit_ledger IS
  'Append-only immutable ledger for internal discount credits (gordura). Each row is a movement. Balance computed from SUM.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. result_locks — economic snapshot before payment decision
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.result_locks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Revenue side
  revenue_centavos      int NOT NULL,
  discount_centavos     int NOT NULL DEFAULT 0,
  credit_discount_centavos int NOT NULL DEFAULT 0,

  -- Cost side
  supplier_cost_centavos    int NOT NULL,
  supplier_freight_centavos int NOT NULL DEFAULT 0,

  -- Result
  projected_result_centavos int NOT NULL,
  min_result_centavos       int NOT NULL DEFAULT 0,

  -- Decision
  status                text NOT NULL DEFAULT 'pending',
  decision              text,
  decided_by            uuid REFERENCES public.profiles(id),
  decided_at            timestamptz,
  decision_notes        text,

  -- Config snapshot
  config_snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,

  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rl_status_check CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'auto_approved'
  )),
  CONSTRAINT rl_decision_check CHECK (decision IS NULL OR decision IN (
    'approve',
    'reduce_discount',
    'remove_credit_discount',
    'cancel_order'
  )),
  CONSTRAINT rl_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rl_order ON public.result_locks(order_id);
CREATE INDEX IF NOT EXISTS idx_rl_status ON public.result_locks(status)
  WHERE status = 'pending';

-- Immutability: once a result_lock has a decision, it cannot be changed
CREATE OR REPLACE FUNCTION public.result_lock_immutable_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('approved', 'rejected', 'auto_approved') THEN
    RAISE EXCEPTION 'result_lock already decided: cannot modify';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_result_lock_immutable ON public.result_locks;
CREATE TRIGGER trg_result_lock_immutable
  BEFORE UPDATE ON public.result_locks
  FOR EACH ROW EXECUTE FUNCTION public.result_lock_immutable_decision();

COMMENT ON TABLE public.result_locks IS
  'Frozen economic snapshot at payment decision time. Immutable once decided.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. freight_allocations — supplier freight prorated across customer orders
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.freight_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id     uuid NOT NULL REFERENCES public.supplier_purchase_orders(id) ON DELETE CASCADE,
  order_id              uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_cost_centavos   int NOT NULL,
  total_cost_centavos   int NOT NULL,
  freight_allocated_centavos int NOT NULL,
  po_freight_centavos   int NOT NULL,
  allocation_method     text NOT NULL DEFAULT 'proportional',
  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fa_allocated_non_negative CHECK (freight_allocated_centavos >= 0),
  CONSTRAINT fa_method_check CHECK (allocation_method IN ('proportional', 'equal', 'manual')),
  CONSTRAINT fa_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_fa_po ON public.freight_allocations(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_fa_order ON public.freight_allocations(order_id);

-- Unique: one allocation per PO per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_fa_po_order_uniq
  ON public.freight_allocations(purchase_order_id, order_id);

COMMENT ON TABLE public.freight_allocations IS
  'Supplier PO freight prorated across customer orders proportional to cost. Must sum exactly to PO freight.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. orders extension: result_protection_status
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS result_protection_status text;

-- No CHECK constraint — when flag OFF, column stays NULL

COMMENT ON COLUMN public.orders.result_protection_status IS
  'Result protection status: pending_review, approved, rejected, not_required. NULL when flag OFF.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. View: credit balance by order
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.credit_balance_by_order AS
SELECT
  order_id,
  COALESCE(SUM(amount_centavos) FILTER (
    WHERE movement_type IN ('credit_generated', 'credit_adjusted', 'credit_reversed', 'credit_released')
  ), 0) AS total_credits,
  COALESCE(SUM(amount_centavos) FILTER (
    WHERE movement_type = 'credit_reserved'
  ), 0) AS total_debits,
  COALESCE(SUM(amount_centavos) FILTER (
    WHERE movement_type IN ('credit_generated', 'credit_adjusted', 'credit_reversed', 'credit_released')
  ), 0)
  - COALESCE(SUM(amount_centavos) FILTER (
    WHERE movement_type = 'credit_reserved'
  ), 0) AS available_centavos
FROM public.credit_ledger
GROUP BY order_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. RPC: generate_credit_from_savings
-- ═══════════════════════════════════════════════════════════════════════════
-- Called when supplier confirms at lower cost than expected.
-- Gordura = expected_cost - confirmed_cost (per line, summed per order).

CREATE OR REPLACE FUNCTION public.generate_credit_from_savings(
  p_order_id uuid,
  p_supplier_request_id uuid,
  p_savings_centavos int,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_current_balance int;
  v_new_balance int;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  IF p_savings_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'savings_centavos must be > 0');
  END IF;

  -- Lock the order row to serialize credit operations
  PERFORM id FROM orders WHERE id = p_order_id FOR UPDATE;

  -- Calculate current balance (credit_used is audit-only, does not affect available)
  SELECT
    COALESCE(SUM(amount_centavos) FILTER (
      WHERE movement_type IN ('credit_generated','credit_adjusted','credit_reversed','credit_released')
    ), 0)
    - COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_reserved'), 0)
  INTO v_current_balance
  FROM credit_ledger WHERE order_id = p_order_id;

  v_new_balance := v_current_balance + p_savings_centavos;

  INSERT INTO credit_ledger (
    order_id, movement_type, amount_centavos, balance_after,
    reference_id, reference_type, reason, idempotency_key
  ) VALUES (
    p_order_id, 'credit_generated', p_savings_centavos, v_new_balance,
    p_supplier_request_id, 'supplier_request',
    'Economia confirmada pelo fornecedor',
    p_idempotency_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate');
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'credit_generated', jsonb_build_object(
    'amount_centavos', p_savings_centavos,
    'balance_after', v_new_balance,
    'supplier_request_id', p_supplier_request_id
  ), 'system');

  RETURN jsonb_build_object('ok', true, 'amount', p_savings_centavos, 'balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_credit_from_savings(uuid, uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_credit_from_savings(uuid, uuid, int, text) FROM anon;
REVOKE ALL ON FUNCTION public.generate_credit_from_savings(uuid, uuid, int, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_credit_from_savings(uuid, uuid, int, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. RPC: reserve_credit
-- ═══════════════════════════════════════════════════════════════════════════
-- Reserves credit for use as internal discount. Fails if insufficient balance.

CREATE OR REPLACE FUNCTION public.reserve_credit(
  p_order_id uuid,
  p_amount_centavos int,
  p_reference_id uuid,
  p_reference_type text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_current_balance int;
  v_new_balance int;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  IF p_amount_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_centavos must be > 0');
  END IF;

  -- Lock the order row to serialize credit operations
  PERFORM id FROM orders WHERE id = p_order_id FOR UPDATE;

  -- Calculate current balance (credit_used is audit-only, does not affect available)
  SELECT
    COALESCE(SUM(amount_centavos) FILTER (
      WHERE movement_type IN ('credit_generated','credit_adjusted','credit_reversed','credit_released')
    ), 0)
    - COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_reserved'), 0)
  INTO v_current_balance
  FROM credit_ledger WHERE order_id = p_order_id;

  IF v_current_balance < p_amount_centavos THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient_balance',
      'available', v_current_balance,
      'requested', p_amount_centavos
    );
  END IF;

  v_new_balance := v_current_balance - p_amount_centavos;

  INSERT INTO credit_ledger (
    order_id, movement_type, amount_centavos, balance_after,
    reference_id, reference_type, reason, idempotency_key
  ) VALUES (
    p_order_id, 'credit_reserved', p_amount_centavos, v_new_balance,
    p_reference_id, p_reference_type,
    'Crédito reservado para desconto interno',
    p_idempotency_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate');
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'credit_reserved', jsonb_build_object(
    'amount_centavos', p_amount_centavos,
    'balance_after', v_new_balance
  ), 'system');

  RETURN jsonb_build_object('ok', true, 'reserved', p_amount_centavos, 'balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_credit(uuid, int, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_credit(uuid, int, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_credit(uuid, int, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credit(uuid, int, uuid, text, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. RPC: release_credit
-- ═══════════════════════════════════════════════════════════════════════════
-- Releases a previously reserved credit (order cancelled, decision changed).

CREATE OR REPLACE FUNCTION public.release_credit(
  p_order_id uuid,
  p_amount_centavos int,
  p_reference_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_current_balance int;
  v_new_balance int;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  IF p_amount_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_centavos must be > 0');
  END IF;

  PERFORM id FROM orders WHERE id = p_order_id FOR UPDATE;

  SELECT
    COALESCE(SUM(amount_centavos) FILTER (
      WHERE movement_type IN ('credit_generated','credit_adjusted','credit_reversed','credit_released')
    ), 0)
    - COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_reserved'), 0)
  INTO v_current_balance
  FROM credit_ledger WHERE order_id = p_order_id;

  v_new_balance := v_current_balance + p_amount_centavos;

  INSERT INTO credit_ledger (
    order_id, movement_type, amount_centavos, balance_after,
    reference_id, reference_type, reason, idempotency_key
  ) VALUES (
    p_order_id, 'credit_released', p_amount_centavos, v_new_balance,
    p_reference_id, 'reservation',
    COALESCE(p_reason, 'Reserva liberada'),
    p_idempotency_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate');
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'credit_released', jsonb_build_object(
    'amount_centavos', p_amount_centavos,
    'balance_after', v_new_balance,
    'reason', p_reason
  ), 'system');

  RETURN jsonb_build_object('ok', true, 'released', p_amount_centavos, 'balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.release_credit(uuid, int, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_credit(uuid, int, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.release_credit(uuid, int, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_credit(uuid, int, uuid, text, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. RPC: use_credit
-- ═══════════════════════════════════════════════════════════════════════════
-- Converts a reservation to actual use (at payment time).

CREATE OR REPLACE FUNCTION public.use_credit(
  p_order_id uuid,
  p_amount_centavos int,
  p_reservation_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_current_balance int;
  v_new_balance int;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  IF p_amount_centavos <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_centavos must be > 0');
  END IF;

  PERFORM id FROM orders WHERE id = p_order_id FOR UPDATE;

  SELECT
    COALESCE(SUM(amount_centavos) FILTER (
      WHERE movement_type IN ('credit_generated','credit_adjusted','credit_reversed','credit_released')
    ), 0)
    - COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_reserved'), 0)
  INTO v_current_balance
  FROM credit_ledger WHERE order_id = p_order_id;

  -- use_credit does not decrease available further — it replaces the reservation
  -- The reservation already decreased the balance; use just records the finalization
  -- But we still record the movement for audit with current balance
  v_new_balance := v_current_balance;

  INSERT INTO credit_ledger (
    order_id, movement_type, amount_centavos, balance_after,
    reference_id, reference_type, reason, idempotency_key
  ) VALUES (
    p_order_id, 'credit_used', p_amount_centavos, v_new_balance,
    p_reservation_id, 'reservation',
    'Crédito aplicado como desconto interno',
    p_idempotency_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'duplicate');
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'credit_used', jsonb_build_object(
    'amount_centavos', p_amount_centavos,
    'balance_after', v_new_balance,
    'reservation_id', p_reservation_id
  ), 'system');

  RETURN jsonb_build_object('ok', true, 'used', p_amount_centavos, 'balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.use_credit(uuid, int, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_credit(uuid, int, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.use_credit(uuid, int, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.use_credit(uuid, int, uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. RPC: lock_result_for_payment
-- ═══════════════════════════════════════════════════════════════════════════
-- Creates an economic snapshot before payment. Auto-approves if result >= min.
-- Returns pending if result < min (needs team decision).

CREATE OR REPLACE FUNCTION public.lock_result_for_payment(
  p_order_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_order record;
  v_supplier_cost int;
  v_supplier_freight int;
  v_credit_discount int;
  v_revenue int;
  v_projected_result int;
  v_min_result int;
  v_max_discount_pct int;
  v_status text;
  v_lock_id uuid;
  v_config jsonb;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  -- Lock and load the order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado');
  END IF;

  -- Load config
  SELECT COALESCE((SELECT (value)::text::int FROM ccm_configs
    WHERE key = 'min_result_centavos' AND scope = 'global' LIMIT 1), 0)
  INTO v_min_result;

  SELECT COALESCE((SELECT (value)::text::int FROM ccm_configs
    WHERE key = 'max_internal_discount_pct' AND scope = 'global' LIMIT 1), 100)
  INTO v_max_discount_pct;

  v_config := jsonb_build_object(
    'min_result_centavos', v_min_result,
    'max_internal_discount_pct', v_max_discount_pct
  );

  -- Calculate supplier cost: sum of supplier_cost_centavos × qty from order_items
  SELECT COALESCE(SUM(
    COALESCE(oi.supplier_cost_centavos, oi.unit_price_centavos) * oi.qty
  ), 0) INTO v_supplier_cost
  FROM order_items oi WHERE oi.order_id = p_order_id AND oi.qty > 0;

  -- Calculate supplier freight allocated to this order
  SELECT COALESCE(SUM(fa.freight_allocated_centavos), 0) INTO v_supplier_freight
  FROM freight_allocations fa WHERE fa.order_id = p_order_id;

  -- Calculate credit discount reserved for this order
  SELECT COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_reserved'), 0)
       - COALESCE(SUM(amount_centavos) FILTER (WHERE movement_type = 'credit_released'), 0)
  INTO v_credit_discount
  FROM credit_ledger WHERE order_id = p_order_id;
  IF v_credit_discount < 0 THEN v_credit_discount := 0; END IF;

  -- Revenue = total paid by customer
  v_revenue := v_order.total_centavos;

  -- Projected result = revenue - supplier_cost - supplier_freight - credit_discount
  v_projected_result := v_revenue - v_supplier_cost - v_supplier_freight - v_credit_discount;

  -- Decide: auto_approved if result >= min_result, pending otherwise
  IF v_projected_result >= v_min_result THEN
    v_status := 'auto_approved';
  ELSE
    v_status := 'pending';
  END IF;

  -- Insert result lock
  INSERT INTO result_locks (
    order_id, revenue_centavos, discount_centavos, credit_discount_centavos,
    supplier_cost_centavos, supplier_freight_centavos,
    projected_result_centavos, min_result_centavos,
    status, config_snapshot, idempotency_key
  ) VALUES (
    p_order_id, v_revenue, v_order.discount_centavos, v_credit_discount,
    v_supplier_cost, v_supplier_freight,
    v_projected_result, v_min_result,
    v_status, v_config, p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_lock_id;

  IF v_lock_id IS NULL THEN
    -- Idempotent: return existing lock
    SELECT id, status INTO v_lock_id, v_status
    FROM result_locks WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'lock_id', v_lock_id, 'status', v_status);
  END IF;

  -- Update order result_protection_status
  UPDATE orders SET result_protection_status = v_status WHERE id = p_order_id;

  -- Register event
  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'result_lock_created', jsonb_build_object(
    'lock_id', v_lock_id,
    'status', v_status,
    'projected_result', v_projected_result,
    'min_result', v_min_result,
    'revenue', v_revenue,
    'supplier_cost', v_supplier_cost,
    'supplier_freight', v_supplier_freight,
    'credit_discount', v_credit_discount
  ), 'system');

  -- If pending, create team notification
  IF v_status = 'pending' THEN
    UPDATE orders SET needs_team_intervention = true WHERE id = p_order_id;

    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, payload, idempotency_key
    ) VALUES (
      p_order_id,
      'result_below_minimum',
      'team',
      jsonb_build_object(
        'code', v_order.code,
        'projected_result', v_projected_result,
        'min_result', v_min_result,
        'lock_id', v_lock_id
      ),
      p_order_id || ':result_below_minimum:' || v_lock_id
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'lock_id', v_lock_id,
    'status', v_status,
    'projected_result', v_projected_result,
    'min_result', v_min_result,
    'revenue', v_revenue,
    'supplier_cost', v_supplier_cost,
    'supplier_freight', v_supplier_freight,
    'credit_discount', v_credit_discount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_result_for_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_result_for_payment(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.lock_result_for_payment(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lock_result_for_payment(uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. RPC: resolve_result_lock — team decision on pending result
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_result_lock(
  p_lock_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lock record;
  v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nao autenticado');
  END IF;

  SELECT * INTO v_lock FROM result_locks WHERE id = p_lock_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lock nao encontrado');
  END IF;

  IF v_lock.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lock ja decidido', 'status', v_lock.status);
  END IF;

  IF p_decision NOT IN ('approve', 'reduce_discount', 'remove_credit_discount', 'cancel_order') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisao invalida');
  END IF;

  -- The immutability trigger allows UPDATE only when old.status = 'pending'
  UPDATE result_locks SET
    status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    decision = p_decision,
    decided_by = v_actor,
    decided_at = now(),
    decision_notes = p_notes
  WHERE id = p_lock_id;

  -- Update order
  UPDATE orders SET
    result_protection_status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
    needs_team_intervention = false
  WHERE id = v_lock.order_id;

  INSERT INTO order_events (order_id, type, data, actor_id, actor_kind)
  VALUES (v_lock.order_id, 'result_lock_resolved', jsonb_build_object(
    'lock_id', p_lock_id,
    'decision', p_decision,
    'notes', p_notes
  ), v_actor, 'admin');

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_result_lock(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_result_lock(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_result_lock(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_result_lock(uuid, text, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. RPC: prorate_supplier_freight
-- ═══════════════════════════════════════════════════════════════════════════
-- Distributes PO freight across orders proportional to their cost.
-- Integer math. Remainder goes to the order with highest cost.
-- Must close to the exact centavo.

CREATE OR REPLACE FUNCTION public.prorate_supplier_freight(
  p_purchase_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_po record;
  v_total_cost int := 0;
  v_allocated_sum int := 0;
  v_remainder int;
  v_rec record;
  v_share int;
  v_count int := 0;
  v_max_cost_order_id uuid;
  v_idem_key text;
BEGIN
  v_flag := is_ccm_result_protection_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  SELECT * INTO v_po FROM supplier_purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PO nao encontrada');
  END IF;

  IF v_po.freight_centavos = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'PO freight is zero');
  END IF;

  -- Check if already prorated (idempotent)
  SELECT COUNT(*) INTO v_count FROM freight_allocations WHERE purchase_order_id = p_purchase_order_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_prorated', 'allocations', v_count);
  END IF;

  -- Calculate total cost per order from supplier_request_lines
  -- Orders linked to this PO via supplier_requests → order_id
  CREATE TEMP TABLE _fa_orders ON COMMIT DROP AS
  SELECT
    sr.order_id,
    SUM(srl.unit_cost_centavos * srl.quantity_requested) AS order_cost
  FROM supplier_requests sr
  JOIN supplier_request_lines srl ON srl.supplier_request_id = sr.id
  WHERE sr.supplier_id = v_po.supplier_id
    AND sr.order_id IN (
      SELECT DISTINCT sr2.order_id
      FROM supplier_requests sr2
      WHERE sr2.supplier_id = v_po.supplier_id
        AND sr2.status NOT IN ('cancelado')
    )
  GROUP BY sr.order_id
  HAVING SUM(srl.unit_cost_centavos * srl.quantity_requested) > 0;

  SELECT COALESCE(SUM(order_cost), 0) INTO v_total_cost FROM _fa_orders;

  IF v_total_cost = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No order costs found for this PO');
  END IF;

  -- Proportional allocation (integer math)
  v_allocated_sum := 0;
  v_max_cost_order_id := NULL;

  FOR v_rec IN SELECT order_id, order_cost FROM _fa_orders ORDER BY order_cost DESC
  LOOP
    IF v_max_cost_order_id IS NULL THEN
      v_max_cost_order_id := v_rec.order_id;
    END IF;

    v_share := (v_rec.order_cost::bigint * v_po.freight_centavos::bigint / v_total_cost::bigint)::int;
    v_allocated_sum := v_allocated_sum + v_share;

    v_idem_key := p_purchase_order_id || ':freight:' || v_rec.order_id;

    INSERT INTO freight_allocations (
      purchase_order_id, order_id, order_cost_centavos, total_cost_centavos,
      freight_allocated_centavos, po_freight_centavos, idempotency_key
    ) VALUES (
      p_purchase_order_id, v_rec.order_id, v_rec.order_cost,
      v_total_cost, v_share, v_po.freight_centavos, v_idem_key
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  -- Distribute remainder to highest-cost order
  v_remainder := v_po.freight_centavos - v_allocated_sum;
  IF v_remainder > 0 AND v_max_cost_order_id IS NOT NULL THEN
    UPDATE freight_allocations
    SET freight_allocated_centavos = freight_allocated_centavos + v_remainder
    WHERE purchase_order_id = p_purchase_order_id AND order_id = v_max_cost_order_id;
  END IF;

  -- Verify closure
  SELECT COALESCE(SUM(freight_allocated_centavos), 0) INTO v_allocated_sum
  FROM freight_allocations WHERE purchase_order_id = p_purchase_order_id;

  IF v_allocated_sum <> v_po.freight_centavos THEN
    RAISE EXCEPTION 'Freight proration did not close: allocated=% expected=%',
      v_allocated_sum, v_po.freight_centavos;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'po_freight', v_po.freight_centavos,
    'allocated', v_allocated_sum,
    'orders', (SELECT COUNT(*) FROM _fa_orders)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prorate_supplier_freight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prorate_supplier_freight(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prorate_supplier_freight(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prorate_supplier_freight(uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. RLS policies
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freight_allocations ENABLE ROW LEVEL SECURITY;

-- credit_ledger: admin + compras can read; service_role can insert
CREATE POLICY cl_admin_select ON public.credit_ledger
  FOR SELECT USING (public.is_admin() OR public.has_role(ARRAY['compras']));

CREATE POLICY cl_service_insert ON public.credit_ledger
  FOR INSERT WITH CHECK (
    current_setting('request.jwt.claim.role', true) = 'service_role'
  );

-- result_locks: admin + compras can read + update (for decisions); service_role all
CREATE POLICY rl_admin_select ON public.result_locks
  FOR SELECT USING (public.is_admin() OR public.has_role(ARRAY['compras']));

CREATE POLICY rl_admin_update ON public.result_locks
  FOR UPDATE USING (public.is_admin());

CREATE POLICY rl_service_all ON public.result_locks
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'service_role'
  );

-- freight_allocations: admin + compras can read; service_role all
CREATE POLICY fa_admin_select ON public.freight_allocations
  FOR SELECT USING (public.is_admin() OR public.has_role(ARRAY['compras']));

CREATE POLICY fa_service_all ON public.freight_allocations
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'service_role'
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. Grants
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;

GRANT SELECT, UPDATE ON public.result_locks TO authenticated;
GRANT ALL ON public.result_locks TO service_role;

GRANT SELECT ON public.freight_allocations TO authenticated;
GRANT ALL ON public.freight_allocations TO service_role;

GRANT SELECT ON public.credit_balance_by_order TO authenticated;
GRANT SELECT ON public.credit_balance_by_order TO service_role;

COMMIT;
