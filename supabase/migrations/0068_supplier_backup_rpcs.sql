-- ============================================================================
-- CCM · 0068 — Supplier Backup RPCs: atomic handoff, granular claims, escalation
-- ============================================================================
--
-- Builds on 0067 foundation. All RPCs are SECURITY DEFINER, service_role only
-- (called by backend/cron, never directly by suppliers).
-- Exception: claim_supplier_request_lines is also callable by authenticated
-- (supplier confirms via portal) with ownership enforcement.
--
-- RPCs created:
--   1. save_ranking_snapshot       — persist ranking decision (idempotent)
--   2. create_backup_request       — handoff winner → backup (atomic, idempotent)
--   3. claim_supplier_request_lines — granular per-qty claims (CAS + idempotent)
--   4. mark_lost_lines             — mark zero-remaining lines as 'perdido'
--   5. escalate_to_team            — escalation flag + event + outbox
--   6. resolve_team_intervention   — clear intervention when no more escalated
--
-- All operations:
--   - Check feature flag (no-op when OFF, except save_ranking_snapshot)
--   - Use deterministic lock ordering (order_items by id ASC)
--   - Use idempotency keys (ON CONFLICT DO NOTHING)
--   - Generate order_events + outbox entries
--   - Never modify legacy confirm_supplier_request flow
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. RPC: save_ranking_snapshot
-- ============================================================================
-- Persists the backend-calculated ranking for one order × master_product.
-- Idempotent: retry with same data = no-op success.
-- Retry with DIFFERENT winner/backup = explicit error (historical integrity).
-- Does NOT require feature flag — ranking is recorded regardless.

CREATE OR REPLACE FUNCTION public.save_ranking_snapshot(
  p_order_id          uuid,
  p_master_product_id uuid,
  p_winner_supplier_id  text,
  p_winner_offer_id     uuid DEFAULT NULL,
  p_winner_score        numeric DEFAULT NULL,
  p_backup_supplier_id  text DEFAULT NULL,
  p_backup_offer_id     uuid DEFAULT NULL,
  p_backup_score        numeric DEFAULT NULL,
  p_ranking_snapshot    jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_new_id uuid;
BEGIN
  -- Check if snapshot already exists for this order × product
  SELECT * INTO v_existing
  FROM supplier_ranking_snapshots
  WHERE order_id = p_order_id AND master_product_id = p_master_product_id;

  IF FOUND THEN
    -- Idempotent retry: same data = success
    IF v_existing.winner_supplier_id IS NOT DISTINCT FROM p_winner_supplier_id
       AND v_existing.backup_supplier_id IS NOT DISTINCT FROM p_backup_supplier_id
    THEN
      RETURN jsonb_build_object(
        'ok', true,
        'snapshot_id', v_existing.id,
        'idempotent', true
      );
    END IF;

    -- Different data = reject (historical integrity)
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Snapshot ja existe com decisao diferente.',
      'existing_winner', v_existing.winner_supplier_id,
      'existing_backup', v_existing.backup_supplier_id
    );
  END IF;

  -- Insert new snapshot
  INSERT INTO supplier_ranking_snapshots (
    order_id, master_product_id,
    winner_supplier_id, winner_offer_id, winner_score,
    backup_supplier_id, backup_offer_id, backup_score,
    ranking_snapshot
  )
  VALUES (
    p_order_id, p_master_product_id,
    p_winner_supplier_id, p_winner_offer_id, p_winner_score,
    p_backup_supplier_id, p_backup_offer_id, p_backup_score,
    p_ranking_snapshot
  )
  RETURNING id INTO v_new_id;

  -- Event
  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (
    p_order_id,
    'ranking_snapshot_salvo',
    jsonb_build_object(
      'master_product_id', p_master_product_id,
      'winner_supplier_id', p_winner_supplier_id,
      'backup_supplier_id', p_backup_supplier_id
    ),
    'system'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'snapshot_id', v_new_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_ranking_snapshot(uuid,uuid,text,uuid,numeric,text,uuid,numeric,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_ranking_snapshot(uuid,uuid,text,uuid,numeric,text,uuid,numeric,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.save_ranking_snapshot(uuid,uuid,text,uuid,numeric,text,uuid,numeric,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_ranking_snapshot(uuid,uuid,text,uuid,numeric,text,uuid,numeric,jsonb) TO service_role;


-- ============================================================================
-- 2. RPC: create_backup_request
-- ============================================================================
-- Atomic handoff: winner request → creates backup request with residual qty.
-- Preconditions: flag ON, role=vencedor, handoff_at IS NULL, backup exists in snapshot.
-- Lock order: winner request FOR UPDATE, then order_items sorted by id ASC.
-- Idempotent: deterministic idempotency_key, ON CONFLICT returns existing.

CREATE OR REPLACE FUNCTION public.create_backup_request(
  p_winner_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_winner record;
  v_order record;
  v_snapshot record;
  v_backup_request_id uuid;
  v_idem_key text;
  v_line record;
  v_residual int;
  v_already_claimed int;
  v_line_qty int;
  v_lines_created int := 0;
  v_total_residual int := 0;
  v_existing_backup_id uuid;
BEGIN
  -- 1. Feature flag check
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_supplier_backup_enabled esta OFF.');
  END IF;

  -- 2. Lock and validate winner request
  SELECT * INTO v_winner
  FROM supplier_requests
  WHERE id = p_winner_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao vencedora nao encontrada.');
  END IF;

  IF v_winner.role <> 'vencedor' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao tem role=vencedor.');
  END IF;

  -- 3. Idempotent: check if handoff already done (retry)
  IF v_winner.handoff_at IS NOT NULL THEN
    -- Find the existing backup created by this handoff
    SELECT id INTO v_existing_backup_id
    FROM supplier_requests
    WHERE transferred_from_request_id = p_winner_request_id
      AND role = 'reserva'
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'backup_request_id', v_existing_backup_id
    );
  END IF;

  -- 4. Lock and validate order (must be pre-payment)
  SELECT * INTO v_order
  FROM orders
  WHERE id = v_winner.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao encontrado.');
  END IF;

  IF v_order.order_status NOT IN ('aguardando-confirmacao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido nao esta em aguardando-confirmacao.');
  END IF;

  -- 5. Find backup supplier from ranking snapshots
  -- We need at least one snapshot with a backup for items in this request
  IF NOT EXISTS (
    SELECT 1 FROM supplier_ranking_snapshots srs
    JOIN supplier_request_lines srl ON srl.master_product_id = srs.master_product_id::text
    WHERE srs.order_id = v_winner.order_id
      AND srl.supplier_request_id = p_winner_request_id
      AND srs.backup_supplier_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum fornecedor reserva configurado no ranking.');
  END IF;

  -- 6. Lock order_items in deterministic order (by id ASC) to prevent deadlock
  -- and compute residual for each line
  v_idem_key := v_winner.order_id || ':backup:' || p_winner_request_id;

  -- Try idempotent insert of backup request first
  -- We use the FIRST backup_supplier_id from the snapshots (all lines of a winner
  -- request come from the same supplier, so the backup is per-snapshot)
  DECLARE
    v_backup_supplier text;
    v_round int;
  BEGIN
    -- Get the backup supplier from the first matching snapshot
    SELECT srs.backup_supplier_id INTO v_backup_supplier
    FROM supplier_ranking_snapshots srs
    JOIN supplier_request_lines srl ON srl.master_product_id = srs.master_product_id::text
    WHERE srs.order_id = v_winner.order_id
      AND srl.supplier_request_id = p_winner_request_id
      AND srs.backup_supplier_id IS NOT NULL
    LIMIT 1;

    IF v_backup_supplier IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Fornecedor reserva nao encontrado nos snapshots.');
    END IF;

    v_round := v_winner.round_number + 1;

    -- Create backup request (idempotent)
    INSERT INTO supplier_requests (
      order_id, supplier_id, status, round_number, idempotency_key,
      role, transferred_from_request_id
    )
    VALUES (
      v_winner.order_id,
      v_backup_supplier,
      'aguardando_confirmacao',
      v_round,
      v_idem_key,
      'reserva',
      p_winner_request_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_backup_request_id;

    IF v_backup_request_id IS NULL THEN
      -- Already exists (idempotent retry)
      SELECT id INTO v_backup_request_id
      FROM supplier_requests WHERE idempotency_key = v_idem_key;

      -- Still mark handoff_at if not set (edge case: partial retry)
      UPDATE supplier_requests SET handoff_at = now()
      WHERE id = p_winner_request_id AND handoff_at IS NULL;

      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'backup_request_id', v_backup_request_id
      );
    END IF;

    -- 7. Create backup lines for each order_item with residual > 0
    -- Lock order_items sorted by id ASC
    FOR v_line IN
      SELECT srl.*, oi.id AS oi_id, oi.qty AS oi_qty, oi.residual_qty AS oi_residual
      FROM supplier_request_lines srl
      JOIN order_items oi ON oi.id = srl.order_item_id
      WHERE srl.supplier_request_id = p_winner_request_id
      ORDER BY oi.id ASC
      FOR UPDATE OF oi
    LOOP
      -- Compute effective residual
      v_residual := v_line.oi_residual;

      IF v_residual IS NULL THEN
        -- residual_qty not yet set: use supplier portion (quantity_requested), NOT total customer qty
        SELECT COALESCE(SUM(qty_claimed), 0) INTO v_already_claimed
        FROM supplier_item_claims
        WHERE order_item_id = v_line.oi_id AND claim_status = 'confirmed';

        v_residual := v_line.quantity_requested - v_already_claimed;

        -- Set residual_qty = supplier portion target (fixed, immutable after this)
        UPDATE order_items SET residual_qty = v_line.quantity_requested
        WHERE id = v_line.oi_id AND residual_qty IS NULL;
      ELSE
        -- residual already set: compute remaining from residual - already_claimed
        SELECT COALESCE(SUM(qty_claimed), 0) INTO v_already_claimed
        FROM supplier_item_claims
        WHERE order_item_id = v_line.oi_id AND claim_status = 'confirmed';

        v_residual := v_residual - v_already_claimed;
      END IF;

      -- Skip if no residual left
      IF v_residual <= 0 THEN
        CONTINUE;
      END IF;

      v_total_residual := v_total_residual + v_residual;

      -- Create backup request line with only the residual quantity
      INSERT INTO supplier_request_lines (
        supplier_request_id, order_item_id, master_product_id,
        product_name, quantity_requested, unit, unit_cost_centavos
      )
      VALUES (
        v_backup_request_id,
        v_line.order_item_id,
        v_line.master_product_id,
        v_line.product_name,
        v_residual,
        v_line.unit,
        v_line.unit_cost_centavos
      );

      v_lines_created := v_lines_created + 1;
    END LOOP;

    -- If no residual items, delete the empty backup request
    IF v_lines_created = 0 THEN
      DELETE FROM supplier_requests WHERE id = v_backup_request_id;
      RETURN jsonb_build_object(
        'ok', true,
        'backup_request_id', null,
        'reason', 'Nenhum residual pendente. Backup nao necessario.'
      );
    END IF;

    -- 8. Mark winner as handed off (but NOT transferred — winner stays eligible)
    UPDATE supplier_requests SET handoff_at = now()
    WHERE id = p_winner_request_id;

    -- 9. Event
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (
      v_winner.order_id,
      'supplier_backup_activated',
      jsonb_build_object(
        'winner_request_id', p_winner_request_id,
        'winner_supplier_id', v_winner.supplier_id,
        'backup_request_id', v_backup_request_id,
        'backup_supplier_id', v_backup_supplier,
        'lines_created', v_lines_created,
        'total_residual_qty', v_total_residual
      ),
      'system'
    );

    -- 10. Outbox: backup activation notification
    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      v_winner.order_id,
      'supplier_backup_activated',
      'supplier',
      v_backup_supplier,
      jsonb_build_object(
        'backup_request_id', v_backup_request_id,
        'winner_request_id', p_winner_request_id,
        'lines', v_lines_created,
        'total_qty', v_total_residual
      ),
      v_winner.order_id || ':supplier_backup_activated:' || p_winner_request_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'backup_request_id', v_backup_request_id,
      'backup_supplier_id', v_backup_supplier,
      'lines_created', v_lines_created,
      'total_residual_qty', v_total_residual
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.create_backup_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_backup_request(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_backup_request(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_backup_request(uuid) TO service_role;


-- ============================================================================
-- 3. RPC: claim_supplier_request_lines
-- ============================================================================
-- Central claim operation. Atomically claims quantities per order_item.
-- CAS: FOR UPDATE on order_items (sorted by id ASC), compute remaining,
-- claim = LEAST(requested, remaining), insert supplier_item_claims.
-- Idempotent: deterministic idempotency_key per line, ON CONFLICT skip.
-- After claiming, marks losing lines as 'perdido' and updates request status.
--
-- Can be called by:
--   - service_role (backend/cron on behalf of supplier)
--   - authenticated supplier (via portal, with ownership check)

CREATE OR REPLACE FUNCTION public.claim_supplier_request_lines(
  p_request_id      uuid,
  p_supplier_id     text,
  p_confirmations   jsonb  -- [{line_id, qty_confirmed, status?, cost_confirmed_centavos?, notes?}]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_req record;
  v_caller_role text;
  v_conf jsonb;
  v_line record;
  v_oi record;
  v_already_claimed int;
  v_remaining int;
  v_to_claim int;
  v_idem_key text;
  v_claim_id uuid;
  v_total_claimed int := 0;
  v_lines_processed int := 0;
  v_claims_created int := 0;
  v_claim_results jsonb := '[]'::jsonb;
BEGIN
  -- 1. Feature flag check
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_supplier_backup_enabled esta OFF.');
  END IF;

  -- 2. Determine caller context
  -- service_role bypasses ownership check; authenticated must own supplier
  v_caller_role := current_setting('request.jwt.claim.role', true);

  IF v_caller_role <> 'service_role' THEN
    IF NOT owns_supplier(p_supplier_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado. Fornecedor nao pertence ao usuario.');
    END IF;
  END IF;

  -- 3. Lock and validate request
  SELECT * INTO v_req
  FROM supplier_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  -- Ownership check: request must belong to the specified supplier
  IF v_req.supplier_id <> p_supplier_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao pertence a este fornecedor.');
  END IF;

  -- Request must be in a claimable state
  IF v_req.status NOT IN ('aguardando_confirmacao', 'confirmado_parcial') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Solicitacao nao esta em estado de confirmacao: ' || v_req.status);
  END IF;

  -- 4. Process each confirmation line
  FOR v_conf IN SELECT * FROM jsonb_array_elements(p_confirmations)
  LOOP
    v_lines_processed := v_lines_processed + 1;

    -- Load and lock the request line
    SELECT * INTO v_line
    FROM supplier_request_lines
    WHERE id = (v_conf->>'line_id')::uuid
      AND supplier_request_id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Linha nao encontrada: ' || (v_conf->>'line_id'));
    END IF;

    -- Update line confirmation data
    UPDATE supplier_request_lines SET
      quantity_confirmed = (v_conf->>'qty_confirmed')::int,
      status = COALESCE(v_conf->>'status', 'confirmado'),
      cost_confirmed_centavos = CASE
        WHEN v_conf->>'cost_confirmed_centavos' IS NOT NULL
        THEN (v_conf->>'cost_confirmed_centavos')::int
        ELSE cost_confirmed_centavos
      END,
      notes = COALESCE(v_conf->>'notes', notes)
    WHERE id = v_line.id;

    -- Skip claim for zero or unavailable
    IF (v_conf->>'qty_confirmed')::int <= 0
       OR COALESCE(v_conf->>'status', 'confirmado') = 'indisponivel'
    THEN
      v_claim_results := v_claim_results || jsonb_build_object(
        'line_id', v_line.id,
        'qty_requested', (v_conf->>'qty_confirmed')::int,
        'qty_claimed', 0,
        'reason', 'zero_or_unavailable'
      );
      CONTINUE;
    END IF;

    -- Lock order_item (CAS)
    SELECT * INTO v_oi
    FROM order_items
    WHERE id = v_line.order_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'Order item nao encontrado: ' || v_line.order_item_id);
    END IF;

    -- Ensure residual_qty is set
    IF v_oi.residual_qty IS NULL THEN
      -- First claim: use supplier portion (quantity_requested), NOT total customer qty
      IF v_line.quantity_requested IS NULL OR v_line.quantity_requested <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error',
          'Cannot determine supplier portion: quantity_requested is null/zero for line ' || v_line.id);
      END IF;
      UPDATE order_items SET residual_qty = v_line.quantity_requested
      WHERE id = v_oi.id;
      v_oi.residual_qty := v_line.quantity_requested;
    END IF;

    -- Compute already claimed (confirmed claims only)
    SELECT COALESCE(SUM(qty_claimed), 0) INTO v_already_claimed
    FROM supplier_item_claims
    WHERE order_item_id = v_oi.id AND claim_status = 'confirmed';

    -- Compute remaining
    v_remaining := v_oi.residual_qty - v_already_claimed;

    -- CAS: claim = LEAST(requested, remaining)
    v_to_claim := LEAST((v_conf->>'qty_confirmed')::int, v_remaining);

    IF v_to_claim <= 0 THEN
      v_claim_results := v_claim_results || jsonb_build_object(
        'line_id', v_line.id,
        'qty_requested', (v_conf->>'qty_confirmed')::int,
        'qty_claimed', 0,
        'reason', 'no_remaining'
      );
      CONTINUE;
    END IF;

    -- Deterministic idempotency key
    v_idem_key := p_request_id || ':claim:' || v_line.id || ':' || v_oi.id;

    -- Insert claim (idempotent)
    INSERT INTO supplier_item_claims (
      order_id, order_item_id,
      supplier_request_id, supplier_request_line_id,
      supplier_id, qty_claimed, claim_status,
      idempotency_key
    )
    VALUES (
      v_req.order_id, v_oi.id,
      p_request_id, v_line.id,
      p_supplier_id, v_to_claim, 'confirmed',
      v_idem_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_claim_id;

    IF v_claim_id IS NOT NULL THEN
      -- New claim created
      v_claims_created := v_claims_created + 1;
      v_total_claimed := v_total_claimed + v_to_claim;

      v_claim_results := v_claim_results || jsonb_build_object(
        'line_id', v_line.id,
        'qty_requested', (v_conf->>'qty_confirmed')::int,
        'qty_claimed', v_to_claim,
        'claim_id', v_claim_id,
        'idempotent', false
      );

      -- Event per claim
      INSERT INTO order_events (order_id, type, data, actor_kind)
      VALUES (
        v_req.order_id,
        'supplier_item_claimed',
        jsonb_build_object(
          'claim_id', v_claim_id,
          'request_id', p_request_id,
          'supplier_id', p_supplier_id,
          'order_item_id', v_oi.id,
          'qty_claimed', v_to_claim,
          'remaining_after', v_remaining - v_to_claim
        ),
        'system'
      );
    ELSE
      -- Idempotent retry: claim already exists
      v_claim_results := v_claim_results || jsonb_build_object(
        'line_id', v_line.id,
        'qty_requested', (v_conf->>'qty_confirmed')::int,
        'qty_claimed', 0,
        'reason', 'idempotent_skip',
        'idempotent', true
      );
    END IF;
  END LOOP;

  -- 5. After all claims: mark lost lines and update request status
  -- (delegated to mark_lost_lines_internal for reuse)
  PERFORM mark_lost_lines_internal(p_request_id);

  -- 6. Determine and update request status based on line outcomes
  PERFORM update_request_status_from_lines(p_request_id);

  -- 7. Outbox
  IF v_claims_created > 0 THEN
    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      v_req.order_id,
      'supplier_claim_registrado',
      'supplier',
      p_supplier_id,
      jsonb_build_object(
        'request_id', p_request_id,
        'claims_created', v_claims_created,
        'total_claimed', v_total_claimed
      ),
      v_req.order_id || ':supplier_claim_registrado:' || p_request_id || ':' || v_claims_created
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'claims_created', v_claims_created,
    'total_claimed', v_total_claimed,
    'lines_processed', v_lines_processed,
    'details', v_claim_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_supplier_request_lines(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_supplier_request_lines(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_supplier_request_lines(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_supplier_request_lines(uuid, text, jsonb) TO service_role;


-- ============================================================================
-- 4. Helper: mark_lost_lines_internal
-- ============================================================================
-- For each order_item in a request's lines, if remaining = 0 and the line
-- has no confirmed claim, mark the line as 'perdido'.
-- If ALL lines of a request are perdido, mark request as 'transferido'.
-- Called internally after claims are processed.

CREATE OR REPLACE FUNCTION public.mark_lost_lines_internal(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line record;
  v_oi record;
  v_already_claimed int;
  v_remaining int;
  v_has_claim boolean;
  v_total_lines int := 0;
  v_lost_lines int := 0;
  v_req record;
BEGIN
  SELECT * INTO v_req FROM supplier_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  FOR v_line IN
    SELECT srl.*
    FROM supplier_request_lines srl
    WHERE srl.supplier_request_id = p_request_id
      AND (srl.status IS NULL OR srl.status NOT IN ('perdido', 'indisponivel'))
    ORDER BY srl.order_item_id
  LOOP
    v_total_lines := v_total_lines + 1;

    -- Check if this line has any confirmed claim
    SELECT EXISTS(
      SELECT 1 FROM supplier_item_claims
      WHERE supplier_request_line_id = v_line.id
        AND claim_status = 'confirmed'
        AND qty_claimed > 0
    ) INTO v_has_claim;

    IF v_has_claim THEN
      CONTINUE;
    END IF;

    -- Check remaining for this order_item
    SELECT * INTO v_oi FROM order_items WHERE id = v_line.order_item_id;
    IF NOT FOUND OR v_oi.residual_qty IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(qty_claimed), 0) INTO v_already_claimed
    FROM supplier_item_claims
    WHERE order_item_id = v_oi.id AND claim_status = 'confirmed';

    v_remaining := v_oi.residual_qty - v_already_claimed;

    IF v_remaining <= 0 THEN
      -- No remaining and no claim for this line = lost
      UPDATE supplier_request_lines
      SET status = 'perdido'
      WHERE id = v_line.id AND (status IS NULL OR status <> 'perdido');

      v_lost_lines := v_lost_lines + 1;

      -- Event
      INSERT INTO order_events (order_id, type, data, actor_kind)
      VALUES (
        v_req.order_id,
        'supplier_line_lost',
        jsonb_build_object(
          'request_id', p_request_id,
          'line_id', v_line.id,
          'order_item_id', v_line.order_item_id,
          'supplier_id', v_req.supplier_id
        ),
        'system'
      );
    END IF;
  END LOOP;

  -- Count total active lines (excluding indisponivel)
  SELECT COUNT(*) INTO v_total_lines
  FROM supplier_request_lines
  WHERE supplier_request_id = p_request_id
    AND (status IS NULL OR status <> 'indisponivel');

  -- Count lost lines
  SELECT COUNT(*) INTO v_lost_lines
  FROM supplier_request_lines
  WHERE supplier_request_id = p_request_id
    AND status = 'perdido';

  -- If ALL active lines are lost, mark request as transferido
  IF v_total_lines > 0 AND v_lost_lines = v_total_lines THEN
    UPDATE supplier_requests
    SET status = 'transferido'
    WHERE id = p_request_id
      AND status NOT IN ('transferido', 'cancelado');

    -- Event
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (
      v_req.order_id,
      'supplier_request_transferred',
      jsonb_build_object(
        'request_id', p_request_id,
        'supplier_id', v_req.supplier_id,
        'lost_lines', v_lost_lines
      ),
      'system'
    );

    -- Outbox
    INSERT INTO order_notification_outbox (
      order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
    )
    VALUES (
      v_req.order_id,
      'supplier_request_transferred',
      'supplier',
      v_req.supplier_id,
      jsonb_build_object('request_id', p_request_id),
      v_req.order_id || ':supplier_request_transferred:' || p_request_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
END;
$$;


-- ============================================================================
-- 5. Helper: update_request_status_from_lines
-- ============================================================================
-- After claims, recompute the request's overall status from its lines.
-- Only updates if request is in a confirmable state.

CREATE OR REPLACE FUNCTION public.update_request_status_from_lines(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req record;
  v_all_confirmed boolean := true;
  v_has_partial boolean := false;
  v_has_lost boolean := false;
  v_has_pending boolean := false;
  v_final_status text;
  v_line record;
BEGIN
  SELECT * INTO v_req FROM supplier_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Only update status if in a claimable state
  IF v_req.status NOT IN ('aguardando_confirmacao', 'confirmado_parcial') THEN
    RETURN;
  END IF;

  FOR v_line IN
    SELECT * FROM supplier_request_lines
    WHERE supplier_request_id = p_request_id
  LOOP
    CASE v_line.status
      WHEN 'confirmado' THEN NULL;
      WHEN 'confirmado_parcial' THEN v_has_partial := true; v_all_confirmed := false;
      WHEN 'perdido' THEN v_has_lost := true; v_all_confirmed := false;
      WHEN 'indisponivel' THEN v_all_confirmed := false;
      ELSE
        -- pendente or NULL = still waiting
        v_has_pending := true;
        v_all_confirmed := false;
    END CASE;
  END LOOP;

  -- If there are still pending lines, keep current status
  IF v_has_pending THEN
    RETURN;
  END IF;

  -- All lines have been resolved
  IF v_all_confirmed THEN
    v_final_status := 'confirmado';
  ELSIF v_has_partial THEN
    v_final_status := 'confirmado_parcial';
  ELSE
    v_final_status := 'confirmado_parcial';
  END IF;

  UPDATE supplier_requests SET
    status = v_final_status,
    responded_at = COALESCE(responded_at, now())
  WHERE id = p_request_id
    AND status IN ('aguardando_confirmacao', 'confirmado_parcial');
END;
$$;


-- ============================================================================
-- 6. RPC: escalate_to_team
-- ============================================================================
-- Called when supplier backup flow cannot resolve (both fail, timeout, etc).
-- Sets request status to 'escalado', order.needs_team_intervention = true.
-- Idempotent: re-escalation is a no-op.

CREATE OR REPLACE FUNCTION public.escalate_to_team(
  p_request_id uuid,
  p_reason text DEFAULT 'Timeout sem resolucao automatica'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_req record;
  v_idem_key text;
BEGIN
  -- Feature flag check
  v_flag := is_ccm_supplier_backup_enabled();
  IF NOT v_flag THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Feature ccm_supplier_backup_enabled esta OFF.');
  END IF;

  -- Lock and validate request
  SELECT * INTO v_req
  FROM supplier_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao nao encontrada.');
  END IF;

  -- Idempotent: already escalated
  IF v_req.status = 'escalado' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Cannot escalate cancelled/transferido requests
  IF v_req.status IN ('cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitacao cancelada, nao pode ser escalada.');
  END IF;

  -- Update request status
  UPDATE supplier_requests SET status = 'escalado'
  WHERE id = p_request_id;

  -- Set order intervention flag
  UPDATE orders SET needs_team_intervention = true
  WHERE id = v_req.order_id;

  -- Event (idempotent via unique type+request combo in idempotency_key)
  v_idem_key := v_req.order_id || ':escalacao_equipe:' || p_request_id;

  INSERT INTO order_events (order_id, type, data, actor_kind)
  VALUES (
    v_req.order_id,
    'supplier_team_escalated',
    jsonb_build_object(
      'request_id', p_request_id,
      'supplier_id', v_req.supplier_id,
      'reason', p_reason,
      'previous_status', v_req.status
    ),
    'system'
  );

  -- Outbox (idempotent)
  INSERT INTO order_notification_outbox (
    order_id, event_type, recipient_type, recipient_id, payload, idempotency_key
  )
  VALUES (
    v_req.order_id,
    'escalacao_equipe',
    'customer',
    COALESCE((SELECT profile_id::text FROM orders WHERE id = v_req.order_id), 'internal'),
    jsonb_build_object(
      'request_id', p_request_id,
      'supplier_id', v_req.supplier_id,
      'reason', p_reason
    ),
    v_idem_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'previous_status', v_req.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_to_team(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escalate_to_team(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.escalate_to_team(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_to_team(uuid, text) TO service_role;


-- ============================================================================
-- 7. RPC: resolve_team_intervention
-- ============================================================================
-- Clears needs_team_intervention ONLY when no more escalated requests exist
-- for the given order. Safe to call repeatedly.

CREATE OR REPLACE FUNCTION public.resolve_team_intervention(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_escalated_count int;
BEGIN
  -- Count remaining escalated requests for this order
  SELECT COUNT(*) INTO v_escalated_count
  FROM supplier_requests
  WHERE order_id = p_order_id AND status = 'escalado';

  IF v_escalated_count > 0 THEN
    -- Still has escalated requests — keep intervention flag
    RETURN jsonb_build_object(
      'ok', true,
      'intervention_cleared', false,
      'remaining_escalated', v_escalated_count
    );
  END IF;

  -- No more escalated requests — clear flag
  UPDATE orders SET needs_team_intervention = false
  WHERE id = p_order_id AND needs_team_intervention = true;

  IF FOUND THEN
    INSERT INTO order_events (order_id, type, data, actor_kind)
    VALUES (
      p_order_id,
      'team_intervention_resolved',
      jsonb_build_object('resolved_at', now()),
      'system'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'intervention_cleared', true,
    'remaining_escalated', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_team_intervention(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_team_intervention(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_team_intervention(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_team_intervention(uuid) TO service_role;


-- ============================================================================
-- 8. Compras RLS for supplier_requests (read requests with role context)
-- ============================================================================
-- Already granted in 0058 for admin; add compras role
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_requests' AND policyname = 'sr_compras_select'
  ) THEN
    CREATE POLICY sr_compras_select ON public.supplier_requests
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['compras']));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_request_lines' AND policyname = 'srl_compras_select'
  ) THEN
    CREATE POLICY srl_compras_select ON public.supplier_request_lines
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM supplier_requests sr
        WHERE sr.id = supplier_request_id AND public.has_role(ARRAY['compras'])
      ));
  END IF;
END $$;


-- ============================================================================
-- 9. Comments
-- ============================================================================

COMMENT ON FUNCTION public.save_ranking_snapshot IS
  'Persists backend-calculated supplier ranking per order x product. Idempotent, rejects conflicting updates.';

COMMENT ON FUNCTION public.create_backup_request IS
  'Atomic handoff: creates backup supplier request with residual quantities. Idempotent.';

COMMENT ON FUNCTION public.claim_supplier_request_lines IS
  'Granular per-qty claims. CAS via FOR UPDATE + LEAST. Both winner and backup can claim. Idempotent.';

COMMENT ON FUNCTION public.mark_lost_lines_internal IS
  'Internal: marks lines with zero remaining as perdido. Marks request as transferido when all lines lost.';

COMMENT ON FUNCTION public.update_request_status_from_lines IS
  'Internal: recomputes request status from its lines after claims.';

COMMENT ON FUNCTION public.escalate_to_team IS
  'Escalates a supplier request to team intervention. Sets needs_team_intervention on order. Idempotent.';

COMMENT ON FUNCTION public.resolve_team_intervention IS
  'Clears needs_team_intervention only when no more escalated requests exist for the order.';

COMMIT;
