-- 0046_entregador_hardening.sql
-- Fase 5 security hardening for entregador role:
--   1. Enforce assigned_to = auth.uid() in transition_shipment_status for entregador
--   2. Enforce assigned_to = auth.uid() in log_shipment_occurrence for entregador
--   3. Define entregador-allowed occurrence types (all 5: attempt, delay, damage, return, note)
--   4. Create 4 SECURITY DEFINER RPCs for data-minimized reads (assigned_to scoped)
-- No new tables. No new state machine. Reuses existing lifecycle.
-- SECURITY: assigned_to is verified server-side, never trusted from client.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. HARDEN transition_shipment_status: assigned_to check for entregador
--    If role = entregador, the shipment MUST be assigned to auth.uid().
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.transition_shipment_status(
  p_shipment_id uuid,
  p_new_status  text,
  p_expected    text,
  p_actor_kind  text default 'admin',
  p_actor_id    uuid default null
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship       record;
  v_ts         timestamptz := now();
  v_upd        int;
  v_caller_id  uuid;
  v_actor_role text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

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
    -- RESOURCE-LEVEL: entregador can only act on shipments assigned to them
    IF v_ship.assigned_to IS NULL OR v_ship.assigned_to <> v_caller_id THEN
      RETURN jsonb_build_object('error', 'Esta entrega não está atribuída a você.');
    END IF;

    -- Entregador: delivery only. Pickup confirmation is operacao/admin at the CD.
    IF NOT (
      (v_ship.status = 'pronto_para_envio' AND p_new_status = 'enviado')
      OR (v_ship.status = 'enviado' AND p_new_status = 'entregue')
    ) THEN
      RETURN jsonb_build_object(
        'error', format('Operação não autorizada para role entregador: %s → %s', v_ship.status, p_new_status)
      );
    END IF;
  END IF;

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

  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  VALUES (
    v_ship.order_id,
    'shipment_status_changed',
    jsonb_build_object('shipment_id', p_shipment_id, 'from', v_ship.status, 'to', p_new_status),
    v_actor_role,
    v_caller_id,
    p_shipment_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_new_status,
    'shipped_at', CASE WHEN p_new_status = 'enviado' AND v_ship.shipped_at IS NULL THEN v_ts ELSE v_ship.shipped_at END,
    'delivered_at', CASE WHEN p_new_status = 'entregue' AND v_ship.delivered_at IS NULL THEN v_ts ELSE v_ship.delivered_at END
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. HARDEN log_shipment_occurrence: assigned_to + type restrictions
--    entregador: all 5 types allowed, but must be assigned
--    operacao: damage + note only (unchanged)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_shipment_occurrence(
  p_shipment_id uuid,
  p_type        text,
  p_description text,
  p_actor_kind  text default 'admin',
  p_actor_id    uuid default null
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship record;
  v_occ_id uuid;
  v_caller_id  uuid;
  v_actor_role text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT role INTO v_actor_role
    FROM profiles
   WHERE id = v_caller_id AND is_active;

  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Acesso negado: usuário inativo ou não encontrado.');
  END IF;

  IF p_type NOT IN ('attempt','delay','damage','return','note') THEN
    RETURN jsonb_build_object('error', format('Tipo inválido: %s', p_type));
  END IF;

  IF v_actor_role = 'operacao' AND p_type NOT IN ('damage', 'note') THEN
    RETURN jsonb_build_object('error', format('Tipo ''%s'' não permitido para operação. Use: damage, note.', p_type));
  END IF;

  IF coalesce(trim(p_description), '') = '' THEN
    RETURN jsonb_build_object('error', 'Descrição obrigatória.');
  END IF;

  SELECT os.id, os.order_id, os.assigned_to INTO v_ship
    FROM order_shipments os
   WHERE os.id = p_shipment_id;

  IF v_ship IS NULL THEN
    RETURN jsonb_build_object('error', 'Shipment não encontrado.');
  END IF;

  -- RESOURCE-LEVEL: entregador can only log occurrences on assigned shipments
  IF v_actor_role = 'entregador' THEN
    IF v_ship.assigned_to IS NULL OR v_ship.assigned_to <> v_caller_id THEN
      RETURN jsonb_build_object('error', 'Esta entrega não está atribuída a você.');
    END IF;
  END IF;

  INSERT INTO shipment_occurrences (shipment_id, type, description, logged_by)
  VALUES (p_shipment_id, p_type, trim(p_description), v_caller_id)
  RETURNING id INTO v_occ_id;

  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  VALUES (
    v_ship.order_id,
    'shipment_occurrence',
    jsonb_build_object('shipment_id', p_shipment_id, 'occurrence_id', v_occ_id, 'type', p_type, 'description', trim(p_description)),
    v_actor_role,
    v_caller_id,
    p_shipment_id
  );

  RETURN jsonb_build_object('ok', true, 'occurrence_id', v_occ_id);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ENTREGADOR READ RPCs — data-minimized, assigned_to scoped
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. Active shipments assigned to the calling entregador
CREATE OR REPLACE FUNCTION public.entregador_active_shipments()
RETURNS TABLE (
  id uuid,
  order_id uuid,
  order_code text,
  customer_first_name text,
  sequence smallint,
  status text,
  delivery_method text,
  promised_from date,
  promised_to date,
  address_district text,
  item_count bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['entregador']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT
    os.id,
    os.order_id,
    o.code::text                                     AS order_code,
    split_part(o.customer->>'name', ' ', 1)::text    AS customer_first_name,
    os.sequence,
    os.status::text,
    os.delivery_method::text,
    os.promised_from,
    os.promised_to,
    (o.address->>'district')::text                   AS address_district,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.assigned_to = auth.uid()
    AND os.status NOT IN ('entregue', 'cancelado')
  ORDER BY
    CASE os.status
      WHEN 'enviado' THEN 1
      WHEN 'pronto_para_envio' THEN 2
      WHEN 'pronto_para_retirada' THEN 3
      ELSE 4
    END,
    os.promised_to ASC NULLS LAST,
    os.updated_at ASC;
END;
$$;

-- 3b. Recent completed shipments for the calling entregador
CREATE OR REPLACE FUNCTION public.entregador_recent_shipments(p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  order_code text,
  customer_first_name text,
  sequence smallint,
  status text,
  delivery_method text,
  promised_from date,
  promised_to date,
  address_district text,
  item_count bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['entregador']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT
    os.id,
    os.order_id,
    o.code::text                                     AS order_code,
    split_part(o.customer->>'name', ' ', 1)::text    AS customer_first_name,
    os.sequence,
    os.status::text,
    os.delivery_method::text,
    os.promised_from,
    os.promised_to,
    (o.address->>'district')::text                   AS address_district,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.assigned_to = auth.uid()
    AND os.status IN ('entregue', 'cancelado')
  ORDER BY os.updated_at DESC
  LIMIT p_limit;
END;
$$;

-- 3c. Shipment detail — full address + phone, no prices/supplier/fiscal
CREATE OR REPLACE FUNCTION public.entregador_shipment_detail(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship record;
  v_items jsonb;
BEGIN
  IF NOT has_role(ARRAY['entregador']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT
    os.id, os.order_id, os.sequence, os.status, os.delivery_method,
    os.promised_from, os.promised_to, os.tracking_code, os.carrier,
    os.shipped_at, os.delivered_at, os.updated_at, os.assigned_to,
    o.code AS order_code,
    split_part(o.customer->>'name', ' ', 1) AS customer_first_name,
    o.customer->>'phone' AS customer_phone,
    o.address->>'street' AS address_street,
    o.address->>'number' AS address_number,
    o.address->>'complement' AS address_complement,
    o.address->>'district' AS address_district,
    o.address->>'city' AS address_city,
    o.address->>'state' AS address_state,
    o.address->>'cep' AS address_cep,
    o.address->>'reference' AS address_reference,
    o.notes
  INTO v_ship
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.id = p_shipment_id;

  IF v_ship IS NULL THEN
    RETURN jsonb_build_object('error', 'Shipment não encontrado.');
  END IF;

  -- RESOURCE-LEVEL: entregador can only see assigned shipments
  IF v_ship.assigned_to IS NULL OR v_ship.assigned_to <> auth.uid() THEN
    RETURN jsonb_build_object('error', 'Esta entrega não está atribuída a você.');
  END IF;

  -- Items: name, qty, unit only — no prices, SKU, images, picked_qty
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'name', oi.name,
      'qty', oi.qty,
      'unit', oi.unit
    ) ORDER BY oi.name
  ), '[]'::jsonb)
  INTO v_items
  FROM order_items oi
  WHERE oi.shipment_id = p_shipment_id;

  RETURN jsonb_build_object(
    'id', v_ship.id,
    'order_id', v_ship.order_id,
    'order_code', v_ship.order_code,
    'customer_name', v_ship.customer_first_name,
    'customer_phone', v_ship.customer_phone,
    'sequence', v_ship.sequence,
    'status', v_ship.status,
    'delivery_method', v_ship.delivery_method,
    'promised_from', v_ship.promised_from,
    'promised_to', v_ship.promised_to,
    'tracking_code', v_ship.tracking_code,
    'carrier', v_ship.carrier,
    'shipped_at', v_ship.shipped_at,
    'delivered_at', v_ship.delivered_at,
    'updated_at', v_ship.updated_at,
    'address_street', v_ship.address_street,
    'address_number', v_ship.address_number,
    'address_complement', v_ship.address_complement,
    'address_district', v_ship.address_district,
    'address_city', v_ship.address_city,
    'address_state', v_ship.address_state,
    'address_cep', v_ship.address_cep,
    'address_reference', v_ship.address_reference,
    'notes', v_ship.notes,
    'items', v_items
  );
END;
$$;

-- 3d. Shipment occurrences for an assigned shipment
CREATE OR REPLACE FUNCTION public.entregador_shipment_occurrences(p_shipment_id uuid)
RETURNS TABLE (
  id uuid,
  type text,
  description text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_to uuid;
BEGIN
  IF NOT has_role(ARRAY['entregador']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT os.assigned_to INTO v_assigned_to
    FROM order_shipments os
   WHERE os.id = p_shipment_id;

  IF v_assigned_to IS NULL OR v_assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Esta entrega não está atribuída a você.';
  END IF;

  RETURN QUERY
  SELECT so.id, so.type::text, so.description, so.occurred_at
  FROM shipment_occurrences so
  WHERE so.shipment_id = p_shipment_id
  ORDER BY so.occurred_at DESC;
END;
$$;
