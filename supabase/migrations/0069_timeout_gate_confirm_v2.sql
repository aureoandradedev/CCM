-- 0069: Timeout Automation + Mathematical Gate + Confirmation V2
--
-- Bloco 2 V3: automates winner/backup timeouts, fixes payment gate,
-- and adds claim-based confirmation (V2) with feature flag dispatch.
--
-- Deliverables:
--   1. check_supplier_request_timeouts() — cron handler for automatic timeout
--   2. pg_cron job: check-supplier-request-timeouts (every minute)
--   3. confirm_supplier_request_v2() — claim-based confirmation with handoff on "não tenho"
--   4. check_order_request_gate V2 — mathematical gate using claims when flag ON
--   5. Event types: winner_timeout, backup_timeout,
--      confirmation_claimed, confirmation_completed
--   6. Outbox entries for internal/app notifications
--
-- Dependencies (already applied):
--   0067: foundation (supplier_ranking_snapshots, supplier_item_claims, residual_qty, etc.)
--   0068: RPCs (create_backup_request, claim_supplier_request_lines, escalate_to_team, etc.)
--
-- Semantic of expires_at:
--   Winner before handoff: instant when system must ACTIVATE backup
--   After handoff: historical only (cron ignores winner with handoff_at IS NOT NULL)
--   Backup: instant when system must ESCALATE to team
--
-- Flag OFF behavior:
--   - check_supplier_request_timeouts() does nothing (early return)
--   - confirm_supplier_request_v2 delegates to legacy confirm_supplier_request
--   - check_order_request_gate uses legacy status-based logic
--   - Legacy orders without residual_qty continue working
--
-- All operations idempotent, FOR UPDATE SKIP LOCKED for cron safety.
--
-- RPC reuse:
--   create_backup_request(uuid) — 0068 — ALREADY creates events/outbox
--   escalate_to_team(uuid, text) — 0068 — ALREADY creates events/outbox/intervention flag
--   claim_supplier_request_lines(uuid, text, jsonb) — 0068 — granular claims


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. check_supplier_request_timeouts() — cron handler
-- ═══════════════════════════════════════════════════════════════════════════
-- Processes expired supplier requests in batches:
--   Winner (role=vencedor, handoff_at IS NULL, expires_at<=now()):
--     - If backup supplier exists in ranking → create_backup_request (sets expires_at after)
--     - If no backup supplier → escalate_to_team
--   Backup (role=reserva, expires_at<=now()):
--     - If unresolved residual remains → escalate_to_team
--     - Never creates round 3 automatically

CREATE OR REPLACE FUNCTION public.check_supplier_request_timeouts()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_processed int := 0;
  v_handoffs int := 0;
  v_escalations int := 0;
  v_skipped int := 0;
  v_rec record;
  v_has_backup boolean;
  v_has_unresolved boolean;
  v_result jsonb;
  v_backup_timeout_min int;
BEGIN
  -- 1. Feature flag gate
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Feature flag OFF');
  END IF;

  -- Pre-fetch backup timeout config
  SELECT (value::text)::int INTO v_backup_timeout_min
  FROM ccm_configs
  WHERE key = 'backup_timeout_minutes' AND scope = 'global';

  IF v_backup_timeout_min IS NULL THEN
    v_backup_timeout_min := 30;
  END IF;

  -- 2. Process expired winner requests (batch, SKIP LOCKED)
  FOR v_rec IN
    SELECT sr.*
    FROM supplier_requests sr
    WHERE sr.expires_at IS NOT NULL
      AND sr.expires_at <= now()
      AND sr.status NOT IN ('confirmado', 'cancelado', 'transferido', 'escalado')
      AND sr.role = 'vencedor'
      AND sr.handoff_at IS NULL
    ORDER BY sr.expires_at ASC
    LIMIT 50
    FOR UPDATE OF sr SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    -- Check if any residual remains unresolved for this request's items
    IF NOT EXISTS (
      SELECT 1 FROM supplier_request_lines srl
        JOIN order_items oi ON oi.id = srl.order_item_id
      WHERE srl.supplier_request_id = v_rec.id
        AND oi.residual_qty IS NOT NULL
        AND oi.residual_qty > 0
        AND COALESCE(
          (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
           WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
          0
        ) < oi.residual_qty
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check if backup supplier exists in ranking snapshot
    v_has_backup := EXISTS (
      SELECT 1 FROM supplier_ranking_snapshots srs
        JOIN supplier_request_lines srl
          ON srl.master_product_id = srs.master_product_id::text
      WHERE srs.order_id = v_rec.order_id
        AND srl.supplier_request_id = v_rec.id
        AND srs.backup_supplier_id IS NOT NULL
        AND srs.backup_supplier_id <> v_rec.supplier_id
    );

    IF v_has_backup THEN
      -- Handoff to backup via existing RPC (creates events/outbox internally)
      v_result := create_backup_request(p_winner_request_id := v_rec.id);

      IF (v_result->>'ok')::boolean THEN
        v_handoffs := v_handoffs + 1;

        -- Set expires_at on the new backup request (RPC doesn't set it)
        IF v_result->>'backup_request_id' IS NOT NULL THEN
          UPDATE supplier_requests
          SET expires_at = now() + (v_backup_timeout_min * interval '1 minute')
          WHERE id = (v_result->>'backup_request_id')::uuid;
        END IF;

        -- Event: winner timeout (the backup_activated event is created by create_backup_request)
        INSERT INTO order_events (order_id, type, data, actor_kind)
        VALUES (v_rec.order_id, 'supplier_winner_timeout', jsonb_build_object(
          'request_id', v_rec.id,
          'supplier_id', v_rec.supplier_id,
          'backup_created', true,
          'expired_at', v_rec.expires_at
        ), 'system');
      END IF;
    ELSE
      -- No backup supplier → escalate (creates events/outbox/intervention internally)
      v_result := escalate_to_team(
        p_request_id := v_rec.id,
        p_reason := 'Winner timeout sem fornecedor reserva disponivel'
      );

      IF (v_result->>'ok')::boolean THEN
        v_escalations := v_escalations + 1;

        INSERT INTO order_events (order_id, type, data, actor_kind)
        VALUES (v_rec.order_id, 'supplier_winner_timeout', jsonb_build_object(
          'request_id', v_rec.id,
          'supplier_id', v_rec.supplier_id,
          'escalated', true,
          'reason', 'no_backup_supplier'
        ), 'system');
      END IF;
    END IF;
  END LOOP;

  -- 3. Process expired backup requests (batch, SKIP LOCKED)
  FOR v_rec IN
    SELECT sr.*
    FROM supplier_requests sr
    WHERE sr.expires_at IS NOT NULL
      AND sr.expires_at <= now()
      AND sr.status NOT IN ('confirmado', 'cancelado', 'transferido', 'escalado')
      AND sr.role = 'reserva'
    ORDER BY sr.expires_at ASC
    LIMIT 50
    FOR UPDATE OF sr SKIP LOCKED
  LOOP
    v_processed := v_processed + 1;

    -- Check if unresolved residual exists
    v_has_unresolved := EXISTS (
      SELECT 1 FROM supplier_request_lines srl
        JOIN order_items oi ON oi.id = srl.order_item_id
      WHERE srl.supplier_request_id = v_rec.id
        AND oi.residual_qty IS NOT NULL
        AND oi.residual_qty > 0
        AND COALESCE(
          (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
           WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
          0
        ) < oi.residual_qty
    );

    IF v_has_unresolved THEN
      -- Escalate — never create round 3 (creates events/outbox/intervention internally)
      v_result := escalate_to_team(
        p_request_id := v_rec.id,
        p_reason := 'Backup timeout com residual nao resolvido'
      );

      IF (v_result->>'ok')::boolean THEN
        v_escalations := v_escalations + 1;

        INSERT INTO order_events (order_id, type, data, actor_kind)
        VALUES (v_rec.order_id, 'supplier_backup_timeout', jsonb_build_object(
          'request_id', v_rec.id,
          'supplier_id', v_rec.supplier_id,
          'escalated', true
        ), 'system');
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'handoffs', v_handoffs,
    'escalations', v_escalations,
    'skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_supplier_request_timeouts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_supplier_request_timeouts() FROM anon;
REVOKE ALL ON FUNCTION public.check_supplier_request_timeouts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_supplier_request_timeouts() TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. pg_cron job: check-supplier-request-timeouts (every minute)
-- ═══════════════════════════════════════════════════════════════════════════
-- Idempotent: unschedule first (wrapped in exception handler for first run)

DO $$
BEGIN
  PERFORM cron.unschedule('check-supplier-request-timeouts');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'check-supplier-request-timeouts',
  '* * * * *',
  $$SELECT public.check_supplier_request_timeouts()$$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. confirm_supplier_request_v2() — claim-based confirmation
-- ═══════════════════════════════════════════════════════════════════════════
-- When flag ON: creates claims for confirmed quantities, triggers immediate
--   handoff on "não tenho" (indisponivel) lines via create_backup_request,
--   winner stays eligible after handoff.
-- When flag OFF: delegates to legacy confirm_supplier_request.
-- Both paths maintain same external contract (params + return shape).

CREATE OR REPLACE FUNCTION public.confirm_supplier_request_v2(
  p_request_id      uuid,
  p_supplier_id     text,
  p_confirmations   jsonb  -- [{line_id, qty_confirmed, status, cost_confirmed_centavos?, notes?}]
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
    -- create_backup_request internally checks ranking and creates events/outbox
    v_handoff_result := create_backup_request(p_winner_request_id := v_req.id);

    IF (v_handoff_result->>'ok')::boolean
       AND v_handoff_result->>'backup_request_id' IS NOT NULL
       AND NOT COALESCE((v_handoff_result->>'idempotent')::boolean, false)
    THEN
      -- Set expires_at on backup (RPC doesn't set it)
      SELECT (value::text)::int INTO v_backup_timeout_min
      FROM ccm_configs
      WHERE key = 'backup_timeout_minutes' AND scope = 'global';

      UPDATE supplier_requests
      SET expires_at = now() + (COALESCE(v_backup_timeout_min, 30) * interval '1 minute')
      WHERE id = (v_handoff_result->>'backup_request_id')::uuid;
    ELSIF NOT COALESCE((v_handoff_result->>'ok')::boolean, false) THEN
      -- create_backup_request failed (e.g., no backup supplier) → escalate
      PERFORM escalate_to_team(
        p_request_id := v_req.id,
        p_reason := 'Winner indisponivel sem fornecedor reserva'
      );
    END IF;
  ELSIF v_has_unavailable AND v_req.role = 'reserva' THEN
    -- Backup says unavailable with unresolved residual → escalate
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

REVOKE ALL ON FUNCTION public.confirm_supplier_request_v2(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_supplier_request_v2(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_request_v2(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_supplier_request_v2(uuid, text, jsonb) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. check_order_request_gate V2 — mathematical gate using claims
-- ═══════════════════════════════════════════════════════════════════════════
-- Flag ON: checks SUM(claims) >= residual_qty for every order_item
--   + needs_team_intervention, escalated requests, customer_acceptance
-- Flag OFF: legacy status-based logic (unchanged from 0058)
-- Never advances to aguardando-pagamento if any blocker exists.

CREATE OR REPLACE FUNCTION public.check_order_request_gate(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_order record;
  v_total_requests int;
  v_resolved_requests int;
  v_has_adjustments boolean := false;
  v_has_residual_items boolean;
  v_all_claims_resolved boolean;
  v_has_intervention boolean;
  v_has_escalated boolean;
  v_has_acceptance_pending boolean;
  v_blocked boolean := false;
  v_block_reasons jsonb := '[]'::jsonb;
BEGIN
  v_flag := is_ccm_supplier_backup_enabled();

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  -- ═══ FLAG OFF: Legacy logic (from 0058, unchanged) ═══
  IF NOT v_flag THEN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE status NOT IN ('aguardando_confirmacao', 'revisao_necessaria')
      )
    INTO v_total_requests, v_resolved_requests
    FROM supplier_requests
    WHERE order_id = p_order_id AND status <> 'cancelado';

    IF v_total_requests = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma solicitacao encontrada para este pedido.');
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM order_items
      WHERE order_id = p_order_id AND qty_confirmed IS NOT NULL AND qty_confirmed <> qty
    ) INTO v_has_adjustments;

    IF v_total_requests = v_resolved_requests AND v_has_adjustments THEN
      UPDATE orders SET customer_acceptance_required = true
      WHERE id = p_order_id AND NOT customer_acceptance_required;
    END IF;

    IF v_total_requests = v_resolved_requests AND NOT v_has_adjustments THEN
      UPDATE orders SET order_status = 'aguardando-pagamento'
      WHERE id = p_order_id AND order_status = 'aguardando-confirmacao';

      INSERT INTO order_notification_outbox (
        order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
      ) VALUES (
        p_order_id, 'pagamento_liberado', 'customer',
        COALESCE(v_order.profile_id::text, 'guest'),
        jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
        p_order_id || ':pagamento_liberado:' || COALESCE(v_order.profile_id::text, 'guest')
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      INSERT INTO order_events (order_id, type, data, actor_kind)
      VALUES (p_order_id, 'gate_liberado', jsonb_build_object(
        'total_requests', v_total_requests, 'has_adjustments', false
      ), 'system');
    END IF;

    IF v_total_requests = v_resolved_requests AND v_has_adjustments THEN
      INSERT INTO order_notification_outbox (
        order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
      ) VALUES (
        p_order_id, 'confirmacao_concluida', 'customer',
        COALESCE(v_order.profile_id::text, 'guest'),
        jsonb_build_object('code', v_order.code, 'has_adjustments', true),
        p_order_id || ':confirmacao_concluida:' || COALESCE(v_order.profile_id::text, 'guest')
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      INSERT INTO order_events (order_id, type, data, actor_kind)
      VALUES (p_order_id, 'confirmacao_concluida_com_ajuste', jsonb_build_object(
        'total_requests', v_total_requests, 'has_adjustments', true
      ), 'system');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'total_requests', v_total_requests,
      'resolved_requests', v_resolved_requests,
      'all_resolved', v_total_requests = v_resolved_requests,
      'has_adjustments', v_has_adjustments
    );
  END IF;

  -- ═══ FLAG ON: Mathematical gate using claims ═══

  -- Check 1: Does this order have items with residual_qty (supplier portion)?
  v_has_residual_items := EXISTS (
    SELECT 1 FROM order_items WHERE order_id = p_order_id AND residual_qty IS NOT NULL
  );

  IF NOT v_has_residual_items THEN
    -- 100% CCM — check other blockers before advancing
    v_has_intervention := v_order.needs_team_intervention;
    v_has_acceptance_pending := v_order.customer_acceptance_required
      AND v_order.customer_accepted_at IS NULL;

    IF v_has_intervention THEN
      v_blocked := true;
      v_block_reasons := v_block_reasons || '"needs_team_intervention"'::jsonb;
    END IF;

    IF v_has_acceptance_pending THEN
      v_blocked := true;
      v_block_reasons := v_block_reasons || '"customer_acceptance_pending"'::jsonb;
    END IF;

    IF NOT v_blocked THEN
      UPDATE orders SET order_status = 'aguardando-pagamento'
      WHERE id = p_order_id AND order_status = 'aguardando-confirmacao';

      INSERT INTO order_notification_outbox (
        order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
      ) VALUES (
        p_order_id, 'pagamento_liberado', 'customer',
        COALESCE(v_order.profile_id::text, 'guest'),
        jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
        p_order_id || ':pagamento_liberado_v2:' || COALESCE(v_order.profile_id::text, 'guest')
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      INSERT INTO order_events (order_id, type, data, actor_kind)
      VALUES (p_order_id, 'gate_liberado', jsonb_build_object(
        'mode', 'ccm_only', 'has_adjustments', false
      ), 'system');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'ccm_only',
      'blocked', v_blocked,
      'block_reasons', v_block_reasons
    );
  END IF;

  -- Check 2: Mathematical claim check
  v_all_claims_resolved := NOT EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.residual_qty IS NOT NULL
      AND oi.residual_qty > 0
      AND COALESCE(
        (SELECT SUM(sic.qty_claimed) FROM supplier_item_claims sic
         WHERE sic.order_item_id = oi.id AND sic.claim_status = 'confirmed'),
        0
      ) < oi.residual_qty
  );

  IF NOT v_all_claims_resolved THEN
    v_blocked := true;
    v_block_reasons := v_block_reasons || '"claims_incomplete"'::jsonb;
  END IF;

  -- Check 3: needs_team_intervention
  IF v_order.needs_team_intervention THEN
    v_blocked := true;
    v_block_reasons := v_block_reasons || '"needs_team_intervention"'::jsonb;
  END IF;

  -- Check 4: Escalated requests
  v_has_escalated := EXISTS (
    SELECT 1 FROM supplier_requests
    WHERE order_id = p_order_id AND status = 'escalado'
  );
  IF v_has_escalated THEN
    v_blocked := true;
    v_block_reasons := v_block_reasons || '"has_escalated_requests"'::jsonb;
  END IF;

  -- Check 5: Customer acceptance pending
  SELECT EXISTS(
    SELECT 1 FROM order_items
    WHERE order_id = p_order_id AND qty_confirmed IS NOT NULL AND qty_confirmed <> qty
  ) INTO v_has_adjustments;

  IF v_has_adjustments AND NOT v_blocked THEN
    UPDATE orders SET customer_acceptance_required = true
    WHERE id = p_order_id AND NOT customer_acceptance_required;
  END IF;

  v_has_acceptance_pending := (v_has_adjustments OR v_order.customer_acceptance_required)
    AND v_order.customer_accepted_at IS NULL;

  IF v_has_acceptance_pending THEN
    v_blocked := true;
    v_block_reasons := v_block_reasons || '"customer_acceptance_pending"'::jsonb;
  END IF;

  -- Check 6: revisao_necessaria
  IF EXISTS (
    SELECT 1 FROM supplier_requests
    WHERE order_id = p_order_id AND status = 'revisao_necessaria'
  ) THEN
    v_blocked := true;
    v_block_reasons := v_block_reasons || '"revisao_necessaria"'::jsonb;
  END IF;

  -- If not blocked → advance to aguardando-pagamento
  IF NOT v_blocked THEN
    UPDATE orders SET order_status = 'aguardando-pagamento'
    WHERE id = p_order_id AND order_status = 'aguardando-confirmacao';

    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    ) VALUES (
      p_order_id, 'pagamento_liberado', 'customer',
      COALESCE(v_order.profile_id::text, 'guest'),
      jsonb_build_object('code', v_order.code, 'total_centavos', v_order.total_centavos),
      p_order_id || ':pagamento_liberado_v2:' || COALESCE(v_order.profile_id::text, 'guest')
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (p_order_id, 'gate_liberado', jsonb_build_object(
      'mode', 'claims_v2',
      'has_adjustments', v_has_adjustments,
      'all_claims_resolved', true
    ), 'system');
  END IF;

  SELECT COUNT(*) INTO v_total_requests
  FROM supplier_requests WHERE order_id = p_order_id AND status <> 'cancelado';

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'claims_v2',
    'total_requests', v_total_requests,
    'all_claims_resolved', v_all_claims_resolved,
    'has_adjustments', v_has_adjustments,
    'blocked', v_blocked,
    'block_reasons', v_block_reasons
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.check_order_request_gate(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_order_request_gate(uuid) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Index for cron timeout queries
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_sr_expires_at_pending
  ON public.supplier_requests (expires_at)
  WHERE expires_at IS NOT NULL
    AND status NOT IN ('confirmado', 'cancelado', 'transferido', 'escalado');


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Comments
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.check_supplier_request_timeouts IS
  'Cron handler: processes expired winner/backup requests. Winner→handoff or escalate. Backup→escalate. Never round 3. Idempotent, SKIP LOCKED.';

COMMENT ON FUNCTION public.confirm_supplier_request_v2 IS
  'Claim-based confirmation (flag ON) with immediate handoff on unavailable lines. Flag OFF delegates to legacy confirm_supplier_request. Idempotent claims.';

COMMENT ON FUNCTION public.check_order_request_gate IS
  'Mathematical payment gate. Flag ON: checks SUM(claims)>=residual_qty + intervention + escalation + acceptance. Flag OFF: legacy status-based.';
