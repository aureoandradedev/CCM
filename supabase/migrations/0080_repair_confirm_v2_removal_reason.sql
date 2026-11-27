-- 0080: Repair confirm_supplier_request_v2 — removal_reason only for indisponivel
--
-- BUG: confirm_supplier_request_v2 set removal_reason for confirmado_parcial,
-- divergencia_quantidade, and divergencia_custo statuses. This triggered the
-- B4 fulfillment trigger (trg_fulfillment_on_removal) which set
-- fulfillment_status='removido', making items invisible to complement rounds.
--
-- FIX: Only set removal_reason when status = 'indisponivel' (actual removal).
-- Partial/divergence statuses keep items active for complement rounds.

CREATE OR REPLACE FUNCTION public.confirm_supplier_request_v2(
  p_request_id      uuid,
  p_supplier_id     text,
  p_confirmations   jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_req record;
  v_caller_id uuid;
  v_caller_role text;
  v_conf jsonb;
  v_line record;
  v_oi record;
  v_all_confirmed boolean := true;
  v_has_partial boolean := false;
  v_has_divergence boolean := false;
  v_has_review boolean := false;
  v_has_unavailable boolean := false;
  v_final_status text;
  v_updated int := 0;
  v_has_adjustments boolean := false;
  v_total_claimed int := 0;
  v_handoff_result jsonb;
  v_already_claimed int;
  v_remaining int;
  v_to_claim int;
  v_idem_key text;
  v_backup_timeout_min int;
BEGIN
  -- 1. Feature flag dispatch
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN confirm_supplier_request(p_request_id, p_supplier_id, p_confirmations);
  END IF;

  -- === V2 path (flag ON) ===

  v_caller_id := auth.uid();
  v_caller_role := current_setting('request.jwt.claim.role', true);

  -- 2. Load and lock request
  SELECT * INTO v_req FROM supplier_requests
    WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  -- Ownership check
  IF v_caller_role <> 'service_role' THEN
    IF NOT owns_supplier(v_req.supplier_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado.');
    END IF;
  END IF;

  IF v_req.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao cancelada.');
  END IF;

  IF v_req.status NOT IN ('aguardando_confirmacao', 'confirmado_parcial') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta solicitacao ja foi respondida.');
  END IF;

  -- 3. Process each confirmation line
  FOR v_conf IN SELECT * FROM jsonb_array_elements(p_confirmations)
  LOOP
    SELECT * INTO v_line FROM supplier_request_lines
      WHERE id = (v_conf->>'line_id')::uuid
        AND supplier_request_id = p_request_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Linha nao encontrada: ' || (v_conf->>'line_id'));
    END IF;

    -- Update line confirmation data
    UPDATE supplier_request_lines SET
      quantity_confirmed = (v_conf->>'qty_confirmed')::int,
      status = v_conf->>'status',
      cost_confirmed_centavos = CASE
        WHEN v_conf->>'cost_confirmed_centavos' IS NOT NULL
        THEN (v_conf->>'cost_confirmed_centavos')::int
        ELSE cost_confirmed_centavos
      END,
      notes = COALESCE(v_conf->>'notes', notes)
    WHERE id = v_line.id;

    v_updated := v_updated + 1;

    -- Feed confirmation into order_items (legacy compatibility)
    -- Only set removal_reason for actual removals (indisponivel).
    -- Partial/divergence statuses keep the item active for complement rounds (B4).
    UPDATE order_items SET
      qty_confirmed = (v_conf->>'qty_confirmed')::int,
      removal_reason = CASE
        WHEN v_conf->>'status' = 'indisponivel' THEN 'Fornecedor: indisponível'
        ELSE removal_reason
      END
    WHERE id = v_line.order_item_id;

    -- 4. Create claim for confirmed quantity (V2 addition)
    IF (v_conf->>'qty_confirmed')::int > 0 THEN
      SELECT * INTO v_oi FROM order_items
        WHERE id = v_line.order_item_id FOR UPDATE;

      IF v_oi.residual_qty IS NULL THEN
        -- Use supplier portion (quantity_requested), NOT total customer qty
        IF v_line.quantity_requested IS NULL OR v_line.quantity_requested <= 0 THEN
          RETURN jsonb_build_object('ok', false, 'error',
            'Cannot determine supplier portion: quantity_requested is null/zero for line ' || v_line.id);
        END IF;
        UPDATE order_items SET residual_qty = v_line.quantity_requested
        WHERE id = v_oi.id;
        v_oi.residual_qty := v_line.quantity_requested;
      END IF;

      IF v_oi.residual_qty IS NOT NULL AND v_oi.residual_qty > 0 THEN
        SELECT COALESCE(SUM(qty_claimed), 0) INTO v_already_claimed
        FROM supplier_item_claims
        WHERE order_item_id = v_oi.id AND claim_status = 'confirmed';

        v_remaining := v_oi.residual_qty - v_already_claimed;
        v_to_claim := LEAST((v_conf->>'qty_confirmed')::int, v_remaining);

        IF v_to_claim > 0 THEN
          v_idem_key := v_line.id || ':claim:' || v_req.supplier_id;

          INSERT INTO supplier_item_claims (
            order_id, order_item_id, supplier_request_id,
            supplier_request_line_id, supplier_id,
            qty_claimed, claim_status, idempotency_key
          ) VALUES (
            v_req.order_id, v_oi.id, p_request_id,
            v_line.id, v_req.supplier_id,
            v_to_claim, 'confirmed', v_idem_key
          ) ON CONFLICT (idempotency_key) DO NOTHING;

          IF FOUND THEN
            v_total_claimed := v_total_claimed + v_to_claim;
          END IF;
        END IF;
      END IF;
    END IF;

    -- Track adjustments
    IF (v_conf->>'qty_confirmed')::int <> v_line.quantity_requested THEN
      v_has_adjustments := true;
    END IF;

    -- Track status composition
    CASE v_conf->>'status'
      WHEN 'confirmado' THEN NULL;
      WHEN 'confirmado_parcial' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'indisponivel' THEN
        v_has_unavailable := true; v_has_partial := true; v_all_confirmed := false;
      WHEN 'divergencia_quantidade' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'divergencia_custo' THEN v_has_divergence := true; v_all_confirmed := false;
      WHEN 'revisao_necessaria' THEN v_has_review := true; v_all_confirmed := false;
      ELSE v_all_confirmed := false;
    END CASE;
  END LOOP;

  -- 5. Determine request-level status
  IF v_has_review THEN
    v_final_status := 'revisao_necessaria';
  ELSIF v_has_divergence THEN
    v_final_status := 'divergencia';
  ELSIF v_has_partial THEN
    v_final_status := 'confirmado_parcial';
  ELSIF v_all_confirmed THEN
    v_final_status := 'confirmado';
  ELSE
    v_final_status := 'divergencia';
  END IF;

  -- 6. Update request
  UPDATE supplier_requests SET
    status = v_final_status,
    responded_at = now(),
    responded_by = COALESCE(v_caller_id, responded_by)
  WHERE id = p_request_id;

  -- 7. Event: confirmation_claimed
  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id)
  VALUES (
    v_req.order_id,
    'supplier_confirmation_claimed',
    jsonb_build_object(
      'request_id', p_request_id,
      'supplier_id', v_req.supplier_id,
      'role', v_req.role,
      'status', v_final_status,
      'items_updated', v_updated,
      'total_claimed', v_total_claimed,
      'has_adjustments', v_has_adjustments,
      'has_unavailable', v_has_unavailable
    ),
    CASE WHEN v_caller_role = 'service_role' THEN 'system' ELSE 'supplier' END,
    v_caller_id
  );

  -- 8. Outbox: request respondida
  INSERT INTO order_notification_outbox (
    order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
  ) VALUES (
    v_req.order_id, 'request_respondida', 'supplier', v_req.supplier_id,
    jsonb_build_object('request_id', p_request_id, 'status', v_final_status,
      'total_claimed', v_total_claimed),
    v_req.order_id || ':request_respondida_v2:' || v_req.supplier_id || ':' || p_request_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  -- 9. Handle "não tenho" lines — immediate handoff for winner before handoff
  IF v_has_unavailable AND v_req.role = 'vencedor' AND v_req.handoff_at IS NULL THEN
    v_handoff_result := create_backup_request(p_winner_request_id := v_req.id);

    IF (v_handoff_result->>'ok')::boolean
       AND v_handoff_result->>'backup_request_id' IS NOT NULL
       AND NOT COALESCE((v_handoff_result->>'idempotent')::boolean, false)
    THEN
      SELECT (value::text)::int INTO v_backup_timeout_min
      FROM ccm_configs
      WHERE key = 'backup_timeout_minutes' AND scope = 'global';

      UPDATE supplier_requests
      SET expires_at = now() + (COALESCE(v_backup_timeout_min, 30) * interval '1 minute')
      WHERE id = (v_handoff_result->>'backup_request_id')::uuid;
    ELSIF NOT COALESCE((v_handoff_result->>'ok')::boolean, false) THEN
      PERFORM escalate_to_team(
        p_request_id := v_req.id,
        p_reason := 'Winner indisponivel sem fornecedor reserva'
      );
    END IF;
  ELSIF v_has_unavailable AND v_req.role = 'reserva' THEN
    IF EXISTS (
      SELECT 1 FROM supplier_request_lines srl
        JOIN order_items oi ON oi.id = srl.order_item_id
      WHERE srl.supplier_request_id = v_req.id
        AND oi.residual_qty IS NOT NULL
        AND oi.residual_qty > 0
        AND COALESCE(
          (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
           WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
          0
        ) < oi.residual_qty
    ) THEN
      PERFORM escalate_to_team(
        p_request_id := v_req.id,
        p_reason := 'Backup indisponivel com residual pendente'
      );
    END IF;
  END IF;

  -- 10. Divergence outbox (for customer notification)
  IF v_final_status IN ('divergencia', 'confirmado_parcial', 'revisao_necessaria') THEN
    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    ) VALUES (
      v_req.order_id, 'divergencia_fornecedor', 'customer',
      COALESCE((SELECT profile_id::text FROM orders WHERE id = v_req.order_id), 'guest'),
      jsonb_build_object('request_id', p_request_id, 'supplier_id', v_req.supplier_id,
        'status', v_final_status),
      v_req.order_id || ':divergencia_v2:' || v_req.supplier_id || ':' || p_request_id
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  -- 11. Check if ALL items for the order are fully resolved → completion event
  IF NOT EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = v_req.order_id
      AND oi.residual_qty IS NOT NULL
      AND oi.residual_qty > 0
      AND COALESCE(
        (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
         WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
        0
      ) < oi.residual_qty
  ) AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = v_req.order_id AND oi.residual_qty IS NOT NULL
  ) THEN
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (v_req.order_id, 'supplier_confirmation_completed', jsonb_build_object(
      'final_request_id', p_request_id,
      'final_supplier_id', v_req.supplier_id
    ), 'system');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_final_status,
    'items_updated', v_updated,
    'total_claimed', v_total_claimed,
    'has_adjustments', v_has_adjustments,
    'has_unavailable', v_has_unavailable
  );
END;
$$;

-- ACLs unchanged (already set in 0069)
