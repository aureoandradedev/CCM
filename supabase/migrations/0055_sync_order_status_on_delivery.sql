-- 0055_sync_order_status_on_delivery.sql
-- When a shipment transitions to 'entregue', check if ALL shipments for
-- that order are now terminal (entregue|cancelado). If yes and at least
-- one is 'entregue', advance the order to its correct final status:
--   payment_status = 'pago'  → order_status = 'pagos'
--   payment_status ≠ 'pago'  → order_status = 'pagamento-pendente'
-- Only advances from operational states (em-separacao, separados).
--
-- Implementation: extend transition_shipment_status with post-transition sync.
-- The sync runs atomically in the same transaction as the shipment update.

BEGIN;

CREATE OR REPLACE FUNCTION public.transition_shipment_status(
  p_shipment_id uuid,
  p_new_status  text,
  p_expected    text,
  p_actor_kind  text DEFAULT 'admin',
  p_actor_id    uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship          record;
  v_ts            timestamptz := now();
  v_upd           int;
  v_caller_id     uuid;
  v_actor_role    text;
  v_total         int;
  v_terminal      int;
  v_has_entregue  boolean;
  v_order         record;
  v_new_order_st  text;
BEGIN
  -- Auth: resolve caller
  v_caller_id := COALESCE(p_actor_id, auth.uid());

  SELECT role INTO v_actor_role
    FROM profiles
   WHERE id = v_caller_id AND is_active;

  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Acesso negado: usuário inativo ou não encontrado.');
  END IF;

  SELECT id, order_id, status, shipped_at, delivered_at, assigned_to
    INTO v_ship
    FROM order_shipments
   WHERE id = p_shipment_id
     FOR UPDATE;

  IF v_ship IS NULL THEN
    RETURN jsonb_build_object('error', 'Shipment não encontrado.');
  END IF;

  IF v_ship.status <> p_expected THEN
    RETURN jsonb_build_object(
      'error', format('Conflito: status atual é ''%s'', esperado ''%s''.', v_ship.status, p_expected),
      'current_status', v_ship.status
    );
  END IF;

  -- Full state machine validation (all roles)
  IF NOT (
    (v_ship.status = 'aguardando_disponibilidade' AND p_new_status IN ('preparando','cancelado'))
    OR (v_ship.status = 'preparando' AND p_new_status IN ('pronto_para_envio','pronto_para_retirada','cancelado'))
    OR (v_ship.status = 'pronto_para_envio' AND p_new_status IN ('enviado','cancelado'))
    OR (v_ship.status = 'pronto_para_retirada' AND p_new_status IN ('entregue','cancelado'))
    OR (v_ship.status = 'enviado' AND p_new_status = 'entregue')
  ) THEN
    RETURN jsonb_build_object(
      'error', format('Transição ''%s'' → ''%s'' não permitida.', v_ship.status, p_new_status)
    );
  END IF;

  -- Per-role transition scope enforcement
  IF v_actor_role = 'operacao' THEN
    IF NOT (
      (v_ship.status = 'aguardando_disponibilidade' AND p_new_status = 'preparando')
      OR (v_ship.status = 'preparando' AND p_new_status IN ('pronto_para_envio', 'pronto_para_retirada'))
    ) THEN
      RETURN jsonb_build_object(
        'error', format('Operação não autorizada para role operacao: %s → %s', v_ship.status, p_new_status)
      );
    END IF;
  END IF;

  IF v_actor_role = 'entregador' THEN
    IF v_ship.assigned_to IS NULL OR v_ship.assigned_to <> v_caller_id THEN
      RETURN jsonb_build_object('error', 'Esta entrega não está atribuída a você.');
    END IF;

    IF NOT (
      (v_ship.status = 'pronto_para_envio' AND p_new_status = 'enviado')
      OR (v_ship.status = 'enviado' AND p_new_status = 'entregue')
    ) THEN
      RETURN jsonb_build_object(
        'error', format('Operação não autorizada para role entregador: %s → %s', v_ship.status, p_new_status)
      );
    END IF;
  END IF;

  -- Update shipment status + timestamps
  UPDATE order_shipments SET
    status       = p_new_status,
    shipped_at   = CASE WHEN p_new_status = 'enviado'  AND shipped_at   IS NULL THEN v_ts ELSE shipped_at   END,
    delivered_at = CASE WHEN p_new_status = 'entregue' AND delivered_at IS NULL THEN v_ts ELSE delivered_at END,
    updated_at   = v_ts
  WHERE id = p_shipment_id AND status = p_expected;

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd = 0 THEN
    RETURN jsonb_build_object('error', 'Race condition: status alterado por outro processo.');
  END IF;

  -- Log shipment event
  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  VALUES (
    v_ship.order_id,
    'shipment_status_changed',
    jsonb_build_object('shipment_id', p_shipment_id, 'from', v_ship.status, 'to', p_new_status),
    v_actor_role,
    v_caller_id,
    p_shipment_id
  );

  -- ═══════════════════════════════════════════════════════════════════════
  -- ORDER STATUS SYNC: when transitioning to 'entregue', check if ALL
  -- shipments are now terminal → advance order to final status.
  -- ═══════════════════════════════════════════════════════════════════════
  IF p_new_status = 'entregue' THEN
    SELECT
      count(*)                                             AS total,
      count(*) FILTER (WHERE status IN ('entregue','cancelado')) AS terminal,
      bool_or(status = 'entregue')                         AS has_entregue
    INTO v_total, v_terminal, v_has_entregue
    FROM order_shipments
    WHERE order_id = v_ship.order_id;

    IF v_total > 0 AND v_total = v_terminal AND v_has_entregue THEN
      SELECT id, order_status, payment_status
        INTO v_order
        FROM orders
       WHERE id = v_ship.order_id
         FOR UPDATE;

      IF v_order IS NOT NULL
         AND v_order.order_status IN ('em-separacao', 'separados')
      THEN
        v_new_order_st := CASE
          WHEN v_order.payment_status = 'pago' THEN 'pagos'
          ELSE 'pagamento-pendente'
        END;

        UPDATE orders
           SET order_status = v_new_order_st,
               updated_at   = v_ts
         WHERE id = v_ship.order_id;

        INSERT INTO order_events (order_id, type, data, actor_kind, actor_id)
        VALUES (
          v_ship.order_id,
          'status',
          jsonb_build_object(
            'de', v_order.order_status,
            'para', v_new_order_st,
            'motivo', 'todos os shipments entregues/cancelados',
            'shipments_total', v_total,
            'shipments_entregues', v_terminal - (SELECT count(*) FROM order_shipments WHERE order_id = v_ship.order_id AND status = 'cancelado')
          ),
          'system',
          NULL
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_new_status,
    'shipped_at', CASE WHEN p_new_status = 'enviado' AND v_ship.shipped_at IS NULL THEN v_ts ELSE v_ship.shipped_at END,
    'delivered_at', CASE WHEN p_new_status = 'entregue' AND v_ship.delivered_at IS NULL THEN v_ts ELSE v_ship.delivered_at END
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL: fix orders that already have all shipments terminal but
-- order_status is still stuck in an operational state.
-- Idempotent: only touches em-separacao/separados; re-running is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_rec   record;
  v_new   text;
  v_count int := 0;
BEGIN
  FOR v_rec IN
    SELECT o.id, o.code, o.order_status, o.payment_status
      FROM orders o
     WHERE o.order_status IN ('em-separacao', 'separados')
       AND NOT EXISTS (
         SELECT 1 FROM order_shipments os
          WHERE os.order_id = o.id
            AND os.status NOT IN ('entregue', 'cancelado')
       )
       AND EXISTS (
         SELECT 1 FROM order_shipments os
          WHERE os.order_id = o.id
            AND os.status = 'entregue'
       )
  LOOP
    v_new := CASE
      WHEN v_rec.payment_status = 'pago' THEN 'pagos'
      ELSE 'pagamento-pendente'
    END;

    UPDATE orders
       SET order_status = v_new,
           updated_at   = now()
     WHERE id = v_rec.id;

    INSERT INTO order_events (order_id, type, data, actor_kind, actor_id)
    VALUES (
      v_rec.id,
      'status',
      jsonb_build_object(
        'de', v_rec.order_status,
        'para', v_new,
        'motivo', 'backfill 0055: todos os shipments entregues/cancelados'
      ),
      'system',
      NULL
    );

    v_count := v_count + 1;
    RAISE NOTICE 'backfill 0055: % (%) % → %', v_rec.code, v_rec.id, v_rec.order_status, v_new;
  END LOOP;

  RAISE NOTICE 'backfill 0055: % pedidos corrigidos.', v_count;
END;
$$;

COMMIT;
