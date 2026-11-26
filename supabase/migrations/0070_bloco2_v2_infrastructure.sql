-- ============================================================================
-- CCM · 0070 — Bloco 2 V2 Infrastructure
-- ============================================================================
--
-- Dependencies: 0067 (foundation), 0068 (RPCs), 0069 (cron + gate + confirm_v2)
--
-- Deliverables:
--   1. Config: backup_cost_threshold_pct (default 15)
--   2. Expand outbox recipient_type to include 'internal','team'
--   3. Relax order_items.qty CHECK to allow qty=0 (removed items)
--   4. RPC: initialize_order_supplier_roles (roles + residual_qty + expires_at)
--   5. Table: supplier_notification_ladder (per-request step tracking)
--   6. RPC: check_notification_ladder (cron handler)
--   7. Fix: accept_order_adjustments V2 (re-triggers gate when flag ON)
--   8. RPC: remove_order_item_v2 (customer item removal, releases claims)
--   9. RPC: accept_backup_delivery_date (customer accepts worse date)
--  10. RPC: manual_activate_backup (admin/compras triggers backup)
--  11. RPC: resolve_escalation_admin (admin resolves escalated request)
--  12. pg_cron job: check-notification-ladder (every minute)
--
-- All operations idempotent. Feature flag gated where appropriate.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Config: backup_cost_threshold_pct
-- ============================================================================

INSERT INTO public.ccm_configs (key, scope, value)
VALUES ('backup_cost_threshold_pct', 'global', '15'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;


-- ============================================================================
-- 2. Expand outbox recipient_type constraint
-- ============================================================================

ALTER TABLE public.order_notification_outbox
  DROP CONSTRAINT IF EXISTS outbox_recipient_type_check;

ALTER TABLE public.order_notification_outbox
  ADD CONSTRAINT outbox_recipient_type_check
  CHECK (recipient_type IN ('customer', 'supplier', 'internal', 'team'));


-- ============================================================================
-- 3. Relax order_items.qty CHECK to allow qty=0 (removed items)
-- ============================================================================

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.order_items'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%qty > 0%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.order_items DROP CONSTRAINT %I', v_constraint_name);
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_qty_check CHECK (qty >= 0);
  END IF;
END $$;


-- ============================================================================
-- 4. RPC: initialize_order_supplier_roles
-- ============================================================================
-- Called by backend (pedido.mjs) AFTER create_supplier_requests_for_order.
-- Sets role + expires_at on supplier_requests and initializes residual_qty
-- on order_items. Idempotent: skips already-set values.
--
-- p_roles:     [{request_id, role, expires_at}] or null (flag OFF path)
-- p_residuals: [{order_item_id, residual_qty}]

CREATE OR REPLACE FUNCTION public.initialize_order_supplier_roles(
  p_order_id  uuid,
  p_roles     jsonb DEFAULT NULL,
  p_residuals jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_role jsonb;
  v_res jsonb;
  v_req record;
  v_updated int := 0;
  v_residual_updated int := 0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  -- Set roles and expires_at (when flag ON)
  IF p_roles IS NOT NULL THEN
    FOR v_role IN SELECT * FROM jsonb_array_elements(p_roles)
    LOOP
      SELECT * INTO v_req FROM supplier_requests
        WHERE id = (v_role->>'request_id')::uuid
          AND order_id = p_order_id
        FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error',
          'Solicitacao nao encontrada: ' || (v_role->>'request_id'));
      END IF;

      UPDATE supplier_requests SET
        role = COALESCE(v_role->>'role', role),
        expires_at = CASE
          WHEN v_role->>'expires_at' IS NOT NULL
          THEN (v_role->>'expires_at')::timestamptz
          ELSE expires_at
        END
      WHERE id = v_req.id;

      v_updated := v_updated + 1;
    END LOOP;
  END IF;

  -- Initialize residual_qty on order_items (idempotent: skip non-NULL)
  IF p_residuals IS NOT NULL THEN
    FOR v_res IN SELECT * FROM jsonb_array_elements(p_residuals)
    LOOP
      UPDATE order_items SET residual_qty = (v_res->>'residual_qty')::int
      WHERE id = (v_res->>'order_item_id')::uuid
        AND order_id = p_order_id
        AND residual_qty IS NULL;

      IF FOUND THEN
        v_residual_updated := v_residual_updated + 1;
      END IF;
    END LOOP;
  END IF;

  IF v_updated > 0 OR v_residual_updated > 0 THEN
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (
      p_order_id,
      'supplier_roles_initialized',
      jsonb_build_object(
        'requests_updated', v_updated,
        'residual_items_initialized', v_residual_updated
      ),
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requests_updated', v_updated,
    'residual_items_initialized', v_residual_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_order_supplier_roles(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_order_supplier_roles(uuid, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.initialize_order_supplier_roles(uuid, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_order_supplier_roles(uuid, jsonb, jsonb) TO service_role;


-- ============================================================================
-- 5. Table: supplier_notification_ladder
-- ============================================================================
-- Per-request step tracking: one row per step sent per supplier_request.
-- Steps: 0, 10, 20, 30, 40, T (minutes from request creation).
-- Idempotent via idempotency_key UNIQUE.

CREATE TABLE IF NOT EXISTS public.supplier_notification_ladder (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_request_id   uuid NOT NULL REFERENCES public.supplier_requests(id) ON DELETE CASCADE,
  step_minutes          int NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  channel               text NOT NULL DEFAULT 'outbox',
  idempotency_key       text NOT NULL,
  CONSTRAINT snl_step_check CHECK (step_minutes >= 0),
  CONSTRAINT snl_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_snl_request ON public.supplier_notification_ladder(supplier_request_id);

ALTER TABLE public.supplier_notification_ladder ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_notification_ladder'
      AND policyname = 'snl_admin_select'
  ) THEN
    CREATE POLICY snl_admin_select ON public.supplier_notification_ladder
      FOR SELECT TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_notification_ladder'
      AND policyname = 'snl_service_all'
  ) THEN
    CREATE POLICY snl_service_all ON public.supplier_notification_ladder
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================================
-- 6. Cron function: check_notification_ladder
-- ============================================================================
-- Runs every minute. For each pending supplier_request with expires_at:
--   - Computes elapsed minutes since sent_at
--   - For each milestone (0,10,20,30,40) not yet sent and <= elapsed:
--     - Inserts into supplier_notification_ladder (idempotent)
--     - Inserts outbox entry for the notification
--   - T-step fires within 1 minute of expiry (final warning)

CREATE OR REPLACE FUNCTION public.check_notification_ladder()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_rec record;
  v_elapsed_min int;
  v_step int;
  v_steps int[] := ARRAY[0, 10, 20, 30, 40];
  v_sent int := 0;
  v_idem_key text;
  v_total_timeout int;
BEGIN
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  FOR v_rec IN
    SELECT sr.id, sr.supplier_id, sr.order_id, sr.sent_at, sr.expires_at,
           sr.role, sr.status
    FROM supplier_requests sr
    WHERE sr.expires_at IS NOT NULL
      AND sr.status IN ('aguardando_confirmacao', 'confirmado_parcial')
      AND sr.expires_at > now()
    ORDER BY sr.sent_at ASC
    LIMIT 100
  LOOP
    v_elapsed_min := EXTRACT(EPOCH FROM (now() - v_rec.sent_at))::int / 60;
    v_total_timeout := EXTRACT(EPOCH FROM (v_rec.expires_at - v_rec.sent_at))::int / 60;

    FOREACH v_step IN ARRAY v_steps
    LOOP
      IF v_step <= v_elapsed_min THEN
        v_idem_key := v_rec.id || ':ladder:' || v_step;

        INSERT INTO supplier_notification_ladder (
          supplier_request_id, step_minutes, channel, idempotency_key
        ) VALUES (
          v_rec.id, v_step, 'outbox', v_idem_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        IF FOUND THEN
          INSERT INTO order_notification_outbox (
            order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
          ) VALUES (
            v_rec.order_id,
            'supplier_reminder',
            'supplier',
            v_rec.supplier_id,
            jsonb_build_object(
              'request_id', v_rec.id,
              'step_minutes', v_step,
              'total_timeout_minutes', v_total_timeout,
              'elapsed_minutes', v_elapsed_min,
              'role', v_rec.role,
              'urgency', CASE
                WHEN v_step >= 40 THEN 'critical'
                WHEN v_step >= 30 THEN 'high'
                WHEN v_step >= 20 THEN 'medium'
                ELSE 'low'
              END
            ),
            v_rec.order_id || ':supplier_reminder:' || v_rec.supplier_id || ':' || v_step
          ) ON CONFLICT (idempotency_key) DO NOTHING;

          v_sent := v_sent + 1;
        END IF;
      END IF;
    END LOOP;

    -- T-step: final warning within 1 minute of expiry
    IF v_elapsed_min >= (v_total_timeout - 1) THEN
      v_idem_key := v_rec.id || ':ladder:T';

      INSERT INTO supplier_notification_ladder (
        supplier_request_id, step_minutes, channel, idempotency_key
      ) VALUES (
        v_rec.id, v_total_timeout, 'outbox', v_idem_key
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      IF FOUND THEN
        INSERT INTO order_notification_outbox (
          order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
        ) VALUES (
          v_rec.order_id,
          'supplier_final_warning',
          'supplier',
          v_rec.supplier_id,
          jsonb_build_object(
            'request_id', v_rec.id,
            'total_timeout_minutes', v_total_timeout,
            'role', v_rec.role,
            'urgency', 'final'
          ),
          v_rec.order_id || ':supplier_final_warning:' || v_rec.supplier_id
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_sent := v_sent + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'notifications_sent', v_sent);
END;
$$;

REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM anon;
REVOKE ALL ON FUNCTION public.check_notification_ladder() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_notification_ladder() TO service_role;

-- pg_cron job: every minute
DO $$
BEGIN
  PERFORM cron.unschedule('check-notification-ladder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'check-notification-ladder',
  '* * * * *',
  $$SELECT public.check_notification_ladder()$$
);

-- Clean up old cron job name if it exists
DO $$
BEGIN
  PERFORM cron.unschedule('process-notification-ladder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;


-- ============================================================================
-- 7. Fix: accept_order_adjustments V2
-- ============================================================================
-- When flag ON: mark acceptance but DON'T advance directly — re-trigger gate.
-- When flag OFF: keep legacy behavior (advance directly).

CREATE OR REPLACE FUNCTION public.accept_order_adjustments(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_flag boolean;
  v_gate_result jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta aguardando aceite.');
  END IF;

  IF NOT v_order.customer_acceptance_required THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este pedido nao requer aceite.');
  END IF;

  UPDATE public.orders SET customer_accepted_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'cliente_aceitou_ajuste', '{}'::jsonb, 'customer');

  v_flag := is_ccm_supplier_backup_enabled();

  IF v_flag THEN
    v_gate_result := check_order_request_gate(p_order_id);
    RETURN jsonb_build_object('ok', true, 'mode', 'v2', 'gate_result', v_gate_result);
  ELSE
    UPDATE public.orders SET order_status = 'aguardando-pagamento'
    WHERE id = p_order_id AND order_status = 'aguardando-confirmacao';

    INSERT INTO public.order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    ) VALUES (
      p_order_id, 'pagamento_liberado', 'customer',
      COALESCE(v_order.profile_id::text, 'guest'),
      jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
      p_order_id || ':pagamento_liberado:' || COALESCE(v_order.profile_id::text, 'guest')
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object('ok', true, 'mode', 'legacy');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_adjustments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_order_adjustments(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_order_adjustments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_order_adjustments(uuid) TO service_role;


-- ============================================================================
-- 8. RPC: remove_order_item_v2
-- ============================================================================
-- Customer removes an item from order (pre-payment only).
-- V2 (flag ON): releases claims, zeros residual_qty. Re-triggers gate.
-- Legacy (flag OFF): simple qty=0 + recalculate.

CREATE OR REPLACE FUNCTION public.remove_order_item_v2(
  p_order_id      uuid,
  p_order_item_id uuid,
  p_reason        text DEFAULT 'Cliente removeu item'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_item record;
  v_flag boolean;
  v_claims_released int := 0;
  v_new_total bigint;
BEGIN
  v_flag := is_ccm_supplier_backup_enabled();

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status NOT IN ('aguardando-confirmacao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao permite remocao neste status.');
  END IF;

  SELECT * INTO v_item FROM order_items
    WHERE id = p_order_item_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item nao encontrado.');
  END IF;

  IF v_flag THEN
    UPDATE supplier_item_claims SET claim_status = 'released'
    WHERE order_item_id = p_order_item_id AND claim_status = 'confirmed';
    GET DIAGNOSTICS v_claims_released = ROW_COUNT;

    UPDATE order_items SET residual_qty = 0 WHERE id = p_order_item_id;

    UPDATE supplier_request_lines SET status = 'perdido'
    WHERE order_item_id = p_order_item_id
      AND status NOT IN ('perdido', 'indisponivel');
  END IF;

  UPDATE order_items SET
    qty = 0,
    qty_confirmed = 0,
    removal_reason = p_reason
  WHERE id = p_order_item_id;

  SELECT COALESCE(SUM(
    CASE WHEN qty > 0 THEN qty * unit_price_centavos ELSE 0 END
  ), 0) INTO v_new_total
  FROM order_items WHERE order_id = p_order_id;

  UPDATE orders SET
    subtotal_centavos = v_new_total,
    total_centavos = v_new_total - COALESCE(discount_centavos, 0) + COALESCE(freight_centavos, 0),
    items_count = (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = p_order_id AND qty > 0)
  WHERE id = p_order_id;

  IF v_new_total = 0 THEN
    UPDATE orders SET order_status = 'cancelado' WHERE id = p_order_id;
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (p_order_id, 'pedido_cancelado', jsonb_build_object(
      'reason', 'Todos os itens removidos pelo cliente'
    ), 'customer');

    RETURN jsonb_build_object('ok', true, 'order_cancelled', true);
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'item_removido_cliente', jsonb_build_object(
    'order_item_id', p_order_item_id,
    'product_name', v_item.name,
    'qty_removed', v_item.qty,
    'claims_released', v_claims_released,
    'new_total_centavos', v_new_total,
    'reason', p_reason
  ), 'customer');

  IF v_flag THEN
    PERFORM check_order_request_gate(p_order_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'claims_released', v_claims_released,
    'new_total_centavos', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_order_item_v2(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_order_item_v2(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v2(uuid, uuid, text) TO service_role;


-- ============================================================================
-- 9. RPC: accept_backup_delivery_date
-- ============================================================================
-- Customer accepts worse delivery date from backup supplier.
-- Sets customer_accepted_at and re-triggers gate.

CREATE OR REPLACE FUNCTION public.accept_backup_delivery_date(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF NOT v_order.customer_acceptance_required THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao requer aceite do cliente.');
  END IF;

  IF v_order.customer_accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  UPDATE orders SET customer_accepted_at = now() WHERE id = p_order_id;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (p_order_id, 'cliente_aceitou_data_backup',
    jsonb_build_object('accepted_at', now()::text), 'customer');

  INSERT INTO order_notification_outbox (
    order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
  ) VALUES (
    p_order_id, 'cliente_aceitou_data_backup', 'internal', 'compras',
    jsonb_build_object('order_id', p_order_id),
    p_order_id || ':cliente_aceitou_data_backup'
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_backup_delivery_date(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_backup_delivery_date(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_backup_delivery_date(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_backup_delivery_date(uuid) TO service_role;


-- ============================================================================
-- 10. RPC: manual_activate_backup
-- ============================================================================
-- Admin/Compras manually activates backup for a winner request.

CREATE OR REPLACE FUNCTION public.manual_activate_backup(
  p_winner_request_id uuid,
  p_reason text DEFAULT 'Ativacao manual pelo Compras'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_winner record;
BEGIN
  IF NOT is_admin() AND NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT * INTO v_winner FROM supplier_requests WHERE id = p_winner_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  IF v_winner.role <> 'vencedor' OR v_winner.handoff_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao e vencedor ativo.');
  END IF;

  v_result := create_backup_request(p_winner_request_id := p_winner_request_id);

  IF (v_result->>'ok')::boolean THEN
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (
      v_winner.order_id,
      'backup_manual_ativado',
      jsonb_build_object(
        'winner_request_id', p_winner_request_id,
        'reason', p_reason,
        'backup_request_id', v_result->>'backup_request_id'
      ),
      'admin'
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.manual_activate_backup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manual_activate_backup(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.manual_activate_backup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manual_activate_backup(uuid, text) TO service_role;


-- ============================================================================
-- 11. RPC: resolve_escalation_admin
-- ============================================================================
-- Admin resolves an escalated supplier_request.
-- Options: 'accept_partial' or 'cancel_items'.
-- Clears intervention flag when no more escalated requests. Re-triggers gate.

CREATE OR REPLACE FUNCTION public.resolve_escalation_admin(
  p_request_id  uuid,
  p_resolution  text,
  p_notes       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req record;
  v_order record;
  v_remaining_escalated int;
BEGIN
  IF NOT is_admin() AND NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
  END IF;

  SELECT * INTO v_req FROM supplier_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  IF v_req.status <> 'escalado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao esta escalada.');
  END IF;

  IF p_resolution NOT IN ('accept_partial', 'cancel_items') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Resolucao invalida. Use: accept_partial, cancel_items.');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_req.order_id FOR UPDATE;

  IF p_resolution = 'accept_partial' THEN
    UPDATE order_items oi SET
      residual_qty = COALESCE(
        (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
         WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
        0
      )
    FROM supplier_request_lines srl
    WHERE srl.order_item_id = oi.id
      AND srl.supplier_request_id = p_request_id
      AND oi.residual_qty IS NOT NULL;

    UPDATE supplier_requests SET status = 'confirmado_parcial'
    WHERE id = p_request_id;

  ELSIF p_resolution = 'cancel_items' THEN
    UPDATE supplier_request_lines SET status = 'perdido'
    WHERE supplier_request_id = p_request_id
      AND status NOT IN ('confirmado', 'confirmado_parcial', 'perdido');

    UPDATE supplier_requests SET status = 'cancelado'
    WHERE id = p_request_id;
  END IF;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (v_req.order_id, 'escalation_resolved', jsonb_build_object(
    'request_id', p_request_id,
    'supplier_id', v_req.supplier_id,
    'resolution', p_resolution,
    'notes', p_notes
  ), 'admin');

  SELECT COUNT(*) INTO v_remaining_escalated
  FROM supplier_requests
  WHERE order_id = v_req.order_id AND status = 'escalado';

  IF v_remaining_escalated = 0 THEN
    UPDATE orders SET needs_team_intervention = false
    WHERE id = v_req.order_id AND needs_team_intervention = true;
  END IF;

  PERFORM check_order_request_gate(v_req.order_id);

  RETURN jsonb_build_object(
    'ok', true,
    'resolution', p_resolution,
    'remaining_escalated', v_remaining_escalated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_escalation_admin(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_escalation_admin(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_escalation_admin(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_escalation_admin(uuid, text, text) TO service_role;


-- ============================================================================
-- 12. Comments
-- ============================================================================

COMMENT ON FUNCTION public.initialize_order_supplier_roles IS
  'Sets role/expires_at on supplier_requests + initializes residual_qty. Called by backend after create_supplier_requests_for_order. Works flag ON (roles+residuals) and flag OFF (residuals only).';

COMMENT ON TABLE public.supplier_notification_ladder IS
  'Per-request notification step log. One row per step sent per supplier_request. Idempotent via idempotency_key.';

COMMENT ON FUNCTION public.check_notification_ladder IS
  'Cron handler: sends notification ladder steps (0/10/20/30/40/T) for pending supplier_requests. Feature-flag gated.';

COMMENT ON FUNCTION public.accept_order_adjustments IS
  'V2: customer accepts adjustments. Flag ON re-triggers gate; flag OFF advances directly to aguardando-pagamento.';

COMMENT ON FUNCTION public.remove_order_item_v2 IS
  'Customer removes an order item pre-payment. V2: releases claims, zeroes residual_qty, recalculates totals. Re-triggers gate.';

COMMENT ON FUNCTION public.accept_backup_delivery_date IS
  'Customer accepts worse delivery date from backup supplier. Sets customer_accepted_at.';

COMMENT ON FUNCTION public.manual_activate_backup IS
  'Admin/Compras manually triggers backup activation for a winner request. Wraps create_backup_request.';

COMMENT ON FUNCTION public.resolve_escalation_admin IS
  'Admin resolves an escalated supplier_request. Options: accept_partial, cancel_items. Clears intervention flag when none remain. Re-triggers gate.';


COMMIT;
