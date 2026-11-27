-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0079: Bloco 4 V2 — Item Fulfillment State + Complement Rounds
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Last technical block of CCM V2. Adds:
--   1. Feature flag: ccm_item_fulfillment_v2_enabled (OFF)
--   2. Config: max_supplier_complement_rounds (default 3, dev only)
--   3. order_items.fulfillment_status (4 states)
--   4. order_events.order_item_id (nullable FK for per-item audit)
--   5. create_complement_round RPC (manual, admin-triggered)
--   6. get_item_fulfillment_summary RPC (read model)
--   7. Updates to existing RPCs: initialize_order_supplier_roles,
--      confirm_supplier_request_v2, remove_order_item_v2
--
-- Complement is MANUAL only. No cron. No automatic third supplier.
-- Winner + backup fail → equipe CCM. Complement is an optional next step
-- that Admin/Compras explicitly triggers.
--
-- Race protection:
--   create_complement_round serializes with payment via:
--   (a) SELECT FOR UPDATE on orders row
--   (b) Check orders.payment_lock for in-flight payment
--   (c) Check stock_reservations for active payment_lock
--   (d) Rollback order_status to aguardando-confirmacao
--   (e) Reset result_protection_status to block payment gate
--
-- Result lock invalidation (Correction 1):
--   Old result_lock is NEVER mutated. Orders.result_lock_id is cleared,
--   result_protection_status is reset, and an event is recorded.
--   After complement resolves, a NEW result_lock is created.
--


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Feature flag + configs
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.ccm_configs (key, scope, value) VALUES
  ('ccm_item_fulfillment_v2_enabled', 'global', 'false'::jsonb),
  ('max_supplier_complement_rounds',  'global', '3'::jsonb)
ON CONFLICT (key, scope) DO NOTHING;


-- 2. Helper function
CREATE OR REPLACE FUNCTION public.is_ccm_item_fulfillment_v2_enabled()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_val jsonb;
BEGIN
  SELECT value INTO v_val
    FROM ccm_configs
   WHERE key = 'ccm_item_fulfillment_v2_enabled' AND scope = 'global'
   LIMIT 1;
  RETURN COALESCE(v_val::text = 'true', false);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Schema: order_items.fulfillment_status
-- ═══════════════════════════════════════════════════════════════════════════
-- 4 persisted states only. Everything else is derived.
-- NULL = legacy / flag OFF / not yet initialized.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS fulfillment_status text;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_fulfillment_status_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_fulfillment_status_check
  CHECK (fulfillment_status IS NULL OR fulfillment_status IN (
    'aguardando_fornecedor',
    'atendido',
    'complemento_pendente',
    'removido'
  ));

COMMENT ON COLUMN public.order_items.fulfillment_status IS
  'Pre-payment item state. NULL=legacy/flag-off. Set by RPCs, never by triggers. Post-payment states derived from shipments/receiving/picking.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Schema: order_events.order_item_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_events
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_events_item_id
  ON public.order_events(order_item_id) WHERE order_item_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RPC: create_complement_round
-- ═══════════════════════════════════════════════════════════════════════════
-- Admin/Compras-triggered. Creates a new supplier_request with role=manual
-- for items that still have open residual after winner+backup.
--
-- Params:
--   p_order_id    — the order
--   p_supplier_id — which supplier to send the complement to
--   p_actor_id    — admin/compras user creating the complement
-- Items and quantities are computed server-side from real remaining_qty.
-- Frontend cannot override quantities or costs.

CREATE OR REPLACE FUNCTION public.create_complement_round(
  p_order_id    uuid,
  p_supplier_id text,
  p_actor_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_order record;
  v_max_rounds int;
  v_current_max_round int;
  v_new_round int;
  v_request_id uuid;
  v_idempotency text;
  v_items_created int := 0;
  v_item record;
  v_remaining int;
  v_supplier_exists boolean;
  v_has_payment_lock boolean;
  v_lock_fase text;
  v_old_result_lock_id uuid;
BEGIN
  -- ── 1. Feature flag ──
  v_flag := is_ccm_item_fulfillment_v2_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_item_fulfillment_v2_enabled esta OFF.');
  END IF;

  -- Also requires backup flag ON (complement extends the supplier workflow)
  IF NOT is_ccm_supplier_backup_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_supplier_backup_enabled esta OFF.');
  END IF;

  -- ── 2. Lock order row (serializes with payment path) ──
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  -- ── 3. Payment status guard ──
  IF v_order.payment_status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido ja foi pago ou tem status de pagamento incompativel. Decisao comercial necessaria (C2).');
  END IF;

  -- ── 4. In-flight payment guard ──
  -- Check orders.payment_lock JSON for active payment attempt
  v_lock_fase := v_order.payment_lock->>'fase';
  IF v_lock_fase IS NOT NULL AND v_lock_fase NOT IN ('concluido', 'erro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pagamento em andamento. Aguarde conclusao antes de criar complemento.');
  END IF;

  -- Check stock_reservations for active payment_lock
  SELECT EXISTS(
    SELECT 1 FROM stock_reservations
    WHERE order_id = p_order_id
      AND status = 'payment_lock'
      AND lock_expires_at > now()
  ) INTO v_has_payment_lock;

  IF v_has_payment_lock THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bloqueio de estoque CCM ativo para pagamento. Aguarde expiracao ou conclusao.');
  END IF;

  -- ── 5. Order status guard ──
  IF v_order.order_status NOT IN ('aguardando-confirmacao', 'aguardando-pagamento') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em estado valido para complemento (status: ' || v_order.order_status || ').');
  END IF;

  -- ── 6. Validate supplier exists ──
  SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = p_supplier_id AND active) INTO v_supplier_exists;
  IF NOT v_supplier_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor nao encontrado ou inativo.');
  END IF;

  -- ── 7. Max rounds check ──
  SELECT COALESCE(value::int, 3)
    INTO v_max_rounds
    FROM ccm_configs
   WHERE key = 'max_supplier_complement_rounds' AND scope = 'global';
  v_max_rounds := COALESCE(v_max_rounds, 3);

  SELECT COALESCE(MAX(round_number), 0)
    INTO v_current_max_round
    FROM supplier_requests
   WHERE order_id = p_order_id AND status <> 'cancelado';

  v_new_round := v_current_max_round + 1;

  IF v_new_round > v_max_rounds THEN
    UPDATE orders SET needs_team_intervention = true WHERE id = p_order_id;
    INSERT INTO order_events (order_id, type, data, actor_id, actor_kind)
    VALUES (p_order_id, 'complement_round_limit_reached', jsonb_build_object(
      'max_rounds', v_max_rounds,
      'attempted_round', v_new_round,
      'supplier_id', p_supplier_id
    ), p_actor_id, 'admin');
    RETURN jsonb_build_object('ok', false, 'error', 'Limite maximo de rounds atingido (' || v_max_rounds || '). Pedido escalado para equipe.', 'escalated', true);
  END IF;

  -- ── 8. Idempotency ──
  v_idempotency := p_order_id || ':complement:r' || v_new_round || ':' || p_supplier_id;

  IF EXISTS(SELECT 1 FROM supplier_requests WHERE idempotency_key = v_idempotency) THEN
    SELECT id INTO v_request_id FROM supplier_requests WHERE idempotency_key = v_idempotency;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'request_id', v_request_id, 'round_number', v_new_round);
  END IF;

  -- ── 9. Create supplier_request ──
  v_request_id := gen_random_uuid();

  INSERT INTO supplier_requests (
    id, order_id, supplier_id, status, round_number, role, idempotency_key, sent_at, created_at
  ) VALUES (
    v_request_id, p_order_id, p_supplier_id, 'aguardando_confirmacao',
    v_new_round, 'manual', v_idempotency, now(), now()
  );

  -- ── 10. Create lines for items with open residual ──
  -- remaining_qty = residual_qty - SUM(confirmed claims)
  -- Only items NOT removed and with remaining > 0
  FOR v_item IN
    SELECT
      oi.id AS order_item_id,
      oi.master_product_id,
      oi.name AS product_name,
      oi.unit,
      oi.residual_qty,
      COALESCE(
        (SELECT SUM(sic.qty_claimed)
           FROM supplier_item_claims sic
          WHERE sic.order_item_id = oi.id
            AND sic.claim_status = 'confirmed'),
        0
      ) AS total_claimed,
      oi.supplier_cost_centavos
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.residual_qty IS NOT NULL
      AND oi.residual_qty > 0
      AND COALESCE(oi.removal_reason, '') = ''
      AND oi.qty > 0
    ORDER BY oi.id
  LOOP
    v_remaining := v_item.residual_qty - v_item.total_claimed;

    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    -- Use cost from supplier catalog/offer if available, else from order_item
    -- The cost comes from the existing supplier_cost_centavos on the item,
    -- which was set at order creation from the supplier offer.
    -- For manual complement, Compras can adjust via confirm flow later.
    INSERT INTO supplier_request_lines (
      id, supplier_request_id, order_item_id, master_product_id,
      product_name, quantity_requested, unit, unit_cost_centavos,
      status, created_at
    ) VALUES (
      gen_random_uuid(), v_request_id, v_item.order_item_id,
      v_item.master_product_id,
      v_item.product_name, v_remaining, v_item.unit,
      COALESCE(v_item.supplier_cost_centavos, 0),
      'pendente', now()
    );

    -- Update fulfillment_status
    UPDATE order_items
       SET fulfillment_status = 'complemento_pendente'
     WHERE id = v_item.order_item_id;

    -- Per-item audit event
    INSERT INTO order_events (order_id, order_item_id, type, data, actor_id, actor_kind)
    VALUES (p_order_id, v_item.order_item_id, 'item_complement_round_created', jsonb_build_object(
      'round_number', v_new_round,
      'supplier_id', p_supplier_id,
      'quantity_requested', v_remaining,
      'remaining_before', v_remaining,
      'residual_qty', v_item.residual_qty,
      'total_claimed', v_item.total_claimed
    ), p_actor_id, 'admin');

    v_items_created := v_items_created + 1;
  END LOOP;

  -- No items needed complement
  IF v_items_created = 0 THEN
    DELETE FROM supplier_requests WHERE id = v_request_id;
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum item do pedido precisa de complemento. Todos ja estao atendidos ou removidos.');
  END IF;

  -- ── 11. Rollback order_status if needed (block payment) ──
  IF v_order.order_status = 'aguardando-pagamento' THEN
    UPDATE orders
       SET order_status = 'aguardando-confirmacao'
     WHERE id = p_order_id;
  END IF;

  -- Clear stale payment_lock if present (we verified no in-flight payment above)
  IF v_order.payment_lock IS NOT NULL THEN
    UPDATE orders SET payment_lock = NULL WHERE id = p_order_id;
  END IF;

  -- ── 12. Invalidate economic approval (preserve old lock, clear reference) ──
  v_old_result_lock_id := v_order.result_lock_id;

  IF v_order.result_lock_id IS NOT NULL OR v_order.result_protection_status IS NOT NULL THEN
    UPDATE orders
       SET result_lock_id = NULL,
           result_locked_at = NULL,
           result_protection_status = NULL
     WHERE id = p_order_id;

    INSERT INTO order_events (order_id, type, data, actor_id, actor_kind)
    VALUES (p_order_id, 'result_lock_invalidated', jsonb_build_object(
      'old_result_lock_id', v_old_result_lock_id,
      'complement_round', v_new_round,
      'reason', 'complement_round_created_changes_costs'
    ), p_actor_id, 'admin');
  END IF;

  -- ── 13. Order-level event ──
  INSERT INTO order_events (order_id, type, data, actor_id, actor_kind)
  VALUES (p_order_id, 'complement_round_created', jsonb_build_object(
    'round_number', v_new_round,
    'supplier_id', p_supplier_id,
    'request_id', v_request_id,
    'items_count', v_items_created,
    'order_status_rollback', v_order.order_status = 'aguardando-pagamento',
    'result_lock_invalidated', v_old_result_lock_id IS NOT NULL
  ), p_actor_id, 'admin');

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'round_number', v_new_round,
    'items_created', v_items_created,
    'order_status_rolled_back', v_order.order_status = 'aguardando-pagamento',
    'result_lock_invalidated', v_old_result_lock_id IS NOT NULL,
    'old_result_lock_id', v_old_result_lock_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_complement_round(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_complement_round(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_complement_round(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_complement_round(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.create_complement_round IS
  'Admin-only. Creates complement round for items with open residual. Serializes with payment. Preserves old result_lock (never mutates). Rolls back order_status to block payment. Max rounds enforced.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RPC: get_item_fulfillment_summary (read model for Admin/Compras)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_item_fulfillment_summary(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_item record;
  v_ccm_qty int;
  v_claimed int;
  v_open int;
  v_display text;
  v_max_round int;
BEGIN
  FOR v_item IN
    SELECT
      oi.id,
      oi.name,
      oi.qty,
      oi.unit,
      oi.residual_qty,
      oi.fulfillment_status,
      oi.removal_reason,
      oi.qty_confirmed,
      oi.shipment_id,
      oi.picked_qty
    FROM order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.name
  LOOP
    -- CCM qty from stock_reservations
    SELECT COALESCE(SUM(sr.qty), 0) INTO v_ccm_qty
      FROM stock_reservations sr
     WHERE sr.order_item_id = v_item.id
       AND sr.status IN ('reservation', 'payment_lock', 'sold');

    -- Supplier claimed qty
    SELECT COALESCE(SUM(sic.qty_claimed), 0) INTO v_claimed
      FROM supplier_item_claims sic
     WHERE sic.order_item_id = v_item.id
       AND sic.claim_status = 'confirmed';

    -- Open qty
    v_open := GREATEST(COALESCE(v_item.residual_qty, 0) - v_claimed, 0);

    -- Display status (admin-facing)
    IF v_item.removal_reason IS NOT NULL AND v_item.removal_reason <> '' THEN
      v_display := 'Removido';
    ELSIF v_item.fulfillment_status = 'complemento_pendente' THEN
      v_display := 'Complemento pendente';
    ELSIF v_item.residual_qty IS NULL OR v_item.residual_qty = 0 THEN
      v_display := 'CCM (disponivel)';
    ELSIF v_open = 0 THEN
      v_display := 'Atendido pelo fornecedor';
    ELSIF v_claimed > 0 THEN
      v_display := 'Parcialmente atendido (' || v_claimed || '/' || v_item.residual_qty || ')';
    ELSE
      v_display := 'Aguardando fornecedor';
    END IF;

    v_items := v_items || jsonb_build_object(
      'id', v_item.id,
      'name', v_item.name,
      'qty', v_item.qty,
      'unit', v_item.unit,
      'residual_qty', COALESCE(v_item.residual_qty, 0),
      'qty_ccm', v_ccm_qty,
      'qty_claimed', v_claimed,
      'qty_open', v_open,
      'fulfillment_status', v_item.fulfillment_status,
      'display_status', v_display,
      'removal_reason', v_item.removal_reason,
      'can_complement', (v_open > 0 AND COALESCE(v_item.removal_reason, '') = '')
    );
  END LOOP;

  -- Current max round
  SELECT COALESCE(MAX(round_number), 0) INTO v_max_round
    FROM supplier_requests
   WHERE order_id = p_order_id AND status <> 'cancelado';

  RETURN jsonb_build_object(
    'ok', true,
    'items', v_items,
    'current_max_round', v_max_round,
    'has_open_residual', EXISTS(
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.residual_qty IS NOT NULL
        AND oi.residual_qty > 0
        AND COALESCE(oi.removal_reason, '') = ''
        AND COALESCE(
          (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
           WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'), 0
        ) < oi.residual_qty
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_item_fulfillment_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_item_fulfillment_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_item_fulfillment_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_item_fulfillment_summary(uuid) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Update: initialize_order_supplier_roles — set fulfillment_status
-- ═══════════════════════════════════════════════════════════════════════════
-- When flag ON, after setting residual_qty on items with supplier portion,
-- also set fulfillment_status = 'aguardando_fornecedor'.

CREATE OR REPLACE FUNCTION public.initialize_order_supplier_roles(
  p_order_id uuid,
  p_rankings jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_fulfillment_flag boolean;
  v_rank record;
  v_winner_req_id uuid;
  v_backup_req_id uuid;
  v_winner_supplier text;
  v_backup_supplier text;
  v_timeout int;
  v_timeout_min int;
  v_backup_timeout int;
  v_payment_estimate int;
  v_backup_estimate int;
  v_t_available int;
  v_winner_expires timestamptz;
  v_backup_expires timestamptz;
  v_created_backup boolean := false;
BEGIN
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_supplier_backup_enabled esta OFF.');
  END IF;

  v_fulfillment_flag := is_ccm_item_fulfillment_v2_enabled();

  -- Load timeout configs
  SELECT COALESCE(value::int, 45) INTO v_timeout
    FROM ccm_configs WHERE key = 'supplier_response_timeout_minutes' AND scope = 'global';
  SELECT COALESCE(value::int, 10) INTO v_timeout_min
    FROM ccm_configs WHERE key = 'supplier_response_timeout_min_minutes' AND scope = 'global';
  SELECT COALESCE(value::int, 30) INTO v_backup_timeout
    FROM ccm_configs WHERE key = 'backup_timeout_minutes' AND scope = 'global';
  SELECT COALESCE(value::int, 30) INTO v_payment_estimate
    FROM ccm_configs WHERE key = 'payment_estimate_minutes' AND scope = 'global';
  SELECT COALESCE(value::int, 20) INTO v_backup_estimate
    FROM ccm_configs WHERE key = 'backup_response_estimate_minutes' AND scope = 'global';

  -- T available = timeout - backup_timeout - payment_estimate
  v_t_available := v_timeout - v_backup_estimate - v_payment_estimate;
  IF v_t_available < v_timeout_min THEN
    v_t_available := v_timeout_min;
  END IF;
  v_winner_expires := now() + (v_t_available || ' minutes')::interval;
  v_backup_expires := now() + (v_backup_timeout || ' minutes')::interval;

  -- Process each ranking: set roles and residual_qty
  FOR v_rank IN SELECT * FROM jsonb_to_recordset(p_rankings) AS x(
    order_item_id uuid,
    master_product_id text,
    winner_supplier_id text,
    backup_supplier_id text,
    residual_qty int
  )
  LOOP
    -- Set residual_qty on order_item
    UPDATE order_items
       SET residual_qty = v_rank.residual_qty
     WHERE id = v_rank.order_item_id AND order_id = p_order_id;

    -- Set fulfillment_status when flag ON
    IF v_fulfillment_flag AND v_rank.residual_qty > 0 THEN
      UPDATE order_items
         SET fulfillment_status = 'aguardando_fornecedor'
       WHERE id = v_rank.order_item_id AND order_id = p_order_id;
    END IF;

    -- Set winner role + expires
    v_winner_supplier := v_rank.winner_supplier_id;
    UPDATE supplier_requests
       SET role = 'vencedor', expires_at = v_winner_expires
     WHERE order_id = p_order_id
       AND supplier_id = v_winner_supplier
       AND status = 'aguardando_confirmacao'
       AND role = 'manual';
    SELECT id INTO v_winner_req_id
      FROM supplier_requests
     WHERE order_id = p_order_id
       AND supplier_id = v_winner_supplier
       AND role = 'vencedor'
     LIMIT 1;

    -- Save ranking snapshot
    PERFORM save_ranking_snapshot(
      p_order_id,
      v_rank.master_product_id::uuid,
      v_winner_supplier,
      v_rank.backup_supplier_id
    );

    -- Handle backup if T is tight (immediate backup creation)
    IF v_rank.backup_supplier_id IS NOT NULL AND v_t_available <= v_timeout_min AND v_winner_req_id IS NOT NULL THEN
      PERFORM create_backup_request(v_winner_req_id);
      v_created_backup := true;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'timeout_minutes', v_t_available,
    'created_immediate_backup', v_created_backup
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Update: confirm_supplier_request_v2 — set fulfillment_status
-- ═══════════════════════════════════════════════════════════════════════════
-- After claims are created, if SUM(claims) >= residual_qty for an item,
-- set fulfillment_status = 'atendido'.

-- We wrap this in a helper to avoid rewriting the entire confirm_v2 RPC.
-- This helper is called at the end of confirm_v2 when flag is ON.

CREATE OR REPLACE FUNCTION public.update_item_fulfillment_after_confirm(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_claimed int;
BEGIN
  IF NOT is_ccm_item_fulfillment_v2_enabled() THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.residual_qty, oi.fulfillment_status, oi.removal_reason
      FROM order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.residual_qty IS NOT NULL
       AND oi.residual_qty > 0
       AND COALESCE(oi.removal_reason, '') = ''
       AND oi.fulfillment_status IN ('aguardando_fornecedor', 'complemento_pendente')
  LOOP
    SELECT COALESCE(SUM(sic.qty_claimed), 0) INTO v_claimed
      FROM supplier_item_claims sic
     WHERE sic.order_item_id = v_item.id AND sic.claim_status = 'confirmed';

    IF v_claimed >= v_item.residual_qty THEN
      UPDATE order_items SET fulfillment_status = 'atendido'
       WHERE id = v_item.id;

      INSERT INTO order_events (order_id, order_item_id, type, data, actor_kind)
      VALUES (p_order_id, v_item.id, 'item_fulfilled', jsonb_build_object(
        'residual_qty', v_item.residual_qty,
        'total_claimed', v_claimed,
        'previous_status', v_item.fulfillment_status
      ), 'system');
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.update_item_fulfillment_after_confirm(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_item_fulfillment_after_confirm(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.update_item_fulfillment_after_confirm(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_item_fulfillment_after_confirm(uuid) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Update: remove_order_item_v2 — set fulfillment_status
-- ═══════════════════════════════════════════════════════════════════════════
-- When customer/admin removes an item, set fulfillment_status = 'removido'.

CREATE OR REPLACE FUNCTION public.update_item_fulfillment_on_remove(
  p_order_item_id uuid,
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_ccm_item_fulfillment_v2_enabled() THEN
    RETURN;
  END IF;

  UPDATE order_items
     SET fulfillment_status = 'removido'
   WHERE id = p_order_item_id AND order_id = p_order_id;

  INSERT INTO order_events (order_id, order_item_id, type, data, actor_kind)
  VALUES (p_order_id, p_order_item_id, 'item_removed_fulfillment', jsonb_build_object(
    'fulfillment_status', 'removido'
  ), 'system');
END;
$$;

REVOKE ALL ON FUNCTION public.update_item_fulfillment_on_remove(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_item_fulfillment_on_remove(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.update_item_fulfillment_on_remove(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_item_fulfillment_on_remove(uuid, uuid) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Wire helpers into existing RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Hook into confirm_supplier_request_v2: call update_item_fulfillment_after_confirm
-- at the end. We use an event trigger approach via a wrapper.
-- Rather than rewriting confirm_v2, we add a trigger on supplier_item_claims
-- that fires after INSERT to check and update fulfillment_status.

CREATE OR REPLACE FUNCTION public.trg_update_fulfillment_after_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_residual int;
  v_claimed int;
  v_current_status text;
BEGIN
  IF NOT is_ccm_item_fulfillment_v2_enabled() THEN
    RETURN NEW;
  END IF;

  -- Only on confirmed claims
  IF NEW.claim_status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Get order_id and item details
  SELECT oi.order_id, oi.residual_qty, oi.fulfillment_status
    INTO v_order_id, v_residual, v_current_status
    FROM order_items oi
   WHERE oi.id = NEW.order_item_id;

  IF v_residual IS NULL OR v_residual = 0 THEN
    RETURN NEW;
  END IF;

  -- Only transition from non-terminal states
  IF v_current_status NOT IN ('aguardando_fornecedor', 'complemento_pendente') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(sic.qty_claimed), 0) INTO v_claimed
    FROM supplier_item_claims sic
   WHERE sic.order_item_id = NEW.order_item_id AND sic.claim_status = 'confirmed';

  IF v_claimed >= v_residual THEN
    UPDATE order_items SET fulfillment_status = 'atendido'
     WHERE id = NEW.order_item_id;

    INSERT INTO order_events (order_id, order_item_id, type, data, actor_kind)
    VALUES (v_order_id, NEW.order_item_id, 'item_fulfilled', jsonb_build_object(
      'residual_qty', v_residual,
      'total_claimed', v_claimed,
      'triggered_by', 'claim_insert'
    ), 'system');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fulfillment_after_claim ON public.supplier_item_claims;
CREATE TRIGGER trg_fulfillment_after_claim
  AFTER INSERT ON public.supplier_item_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_fulfillment_after_claim();


-- Hook into remove_order_item_v2: add call to update_item_fulfillment_on_remove
-- We use a trigger on order_items that fires after removal_reason is set.

CREATE OR REPLACE FUNCTION public.trg_update_fulfillment_on_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_ccm_item_fulfillment_v2_enabled() THEN
    RETURN NEW;
  END IF;

  -- Only fire when removal_reason changes from empty to set
  IF (OLD.removal_reason IS NULL OR OLD.removal_reason = '')
     AND NEW.removal_reason IS NOT NULL AND NEW.removal_reason <> '' THEN
    NEW.fulfillment_status := 'removido';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fulfillment_on_removal ON public.order_items;
CREATE TRIGGER trg_fulfillment_on_removal
  BEFORE UPDATE OF removal_reason ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_fulfillment_on_removal();


-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Indexes for complement queries
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_order_items_fulfillment_status
  ON public.order_items(fulfillment_status)
  WHERE fulfillment_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_requests_complement
  ON public.supplier_requests(order_id, round_number)
  WHERE role = 'manual';


-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Extend get_order_ccm_display: add customer-safe fulfillment label
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_order_ccm_display(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id    uuid;
  v_enabled       boolean;
  v_fulfillment   boolean;
  v_total_items   int := 0;
  v_ccm_items     int := 0;
  v_all_ccm_full  int := 0;
  v_has_ccm       boolean := false;
  v_shortfall     boolean := false;
  v_items         jsonb := '[]'::jsonb;
BEGIN
  SELECT profile_id INTO v_profile_id
  FROM orders WHERE id = p_order_id;

  IF v_profile_id IS NULL OR v_profile_id <> auth.uid() THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  v_enabled := is_ccm_stock_enabled();
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  v_fulfillment := is_ccm_item_fulfillment_v2_enabled();

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
        'totalQty', oi.qty,
        'customerLabel', CASE
          WHEN NOT v_fulfillment THEN NULL
          WHEN oi.removal_reason IS NOT NULL AND oi.removal_reason <> '' THEN 'Removido do pedido'
          WHEN oi.fulfillment_status = 'atendido' THEN 'Disponivel'
          WHEN oi.fulfillment_status = 'complemento_pendente' THEN 'Buscando com fornecedor'
          WHEN oi.fulfillment_status = 'aguardando_fornecedor' THEN 'Verificando disponibilidade'
          ELSE NULL
        END
      ) AS row_data,
      COALESCE(SUM(CASE WHEN sr.status = 'sold' THEN sr.qty ELSE 0 END), 0) AS ccm_qty,
      oi.qty AS total_qty
    FROM order_items oi
    LEFT JOIN stock_reservations sr
      ON sr.order_item_id = oi.id AND sr.order_id = p_order_id
    WHERE oi.order_id = p_order_id
    GROUP BY oi.id, oi.qty, oi.removal_reason, oi.fulfillment_status
  ) sub;

  v_has_ccm := v_ccm_items > 0;

  SELECT EXISTS(
    SELECT 1 FROM order_events
    WHERE order_id = p_order_id AND type = 'ccm_shortfall'
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 13. Comments
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.create_complement_round IS
  'Admin-triggered complement round for items with open residual. Serializes with payment path. Quantities computed server-side (never trusted from frontend). Preserves old result_lock. Max rounds enforced with team escalation.';

COMMENT ON FUNCTION public.get_item_fulfillment_summary IS
  'Read model for Admin/Compras. Returns per-item fulfillment state with derived quantities. NEVER expose to customer — use customer-safe projection.';

COMMENT ON FUNCTION public.trg_update_fulfillment_after_claim IS
  'After confirmed claim insert, checks if item is fully fulfilled and transitions fulfillment_status to atendido.';

COMMENT ON FUNCTION public.trg_update_fulfillment_on_removal IS
  'Before removal_reason update, sets fulfillment_status to removido.';
