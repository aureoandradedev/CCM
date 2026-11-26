-- Migration 0072: Repair missing functions from 0070
--
-- Migration 0070 was recorded as applied but 3 functions are missing
-- from the database (likely due to BEGIN/COMMIT interaction with CLI
-- transaction wrapping). This re-applies them using CREATE OR REPLACE.
--
-- Missing: check_notification_ladder, remove_order_item_v2, resolve_escalation_admin
-- Includes the security fix for resolve_escalation_admin (GRANT to authenticated)

-- ============================================================================
-- 1. check_notification_ladder (cron handler for notification steps)
-- ============================================================================

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

-- Re-schedule cron job (idempotent)
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

-- ============================================================================
-- 2. remove_order_item_v2 (customer item removal with claim release)
-- ============================================================================

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
-- 3. resolve_escalation_admin (with security fix: GRANT to authenticated)
-- ============================================================================

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
GRANT EXECUTE ON FUNCTION public.resolve_escalation_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_escalation_admin(uuid, text, text) TO service_role;
