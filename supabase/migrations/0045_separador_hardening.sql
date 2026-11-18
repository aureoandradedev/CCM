-- 0045_separador_hardening.sql
-- Fase 4 security hardening for operacao role:
--   1. DB-level transition scope enforcement derived from auth.uid() profile
--   2. Column-level security via SECURITY DEFINER RPCs (replace direct table access)
--   3. Item-by-item pick persistence (picked_qty on order_items)
--   4. Occurrence type scoping derived from auth.uid() profile
-- No new tables. No new state machine. Minimal changes.
-- SECURITY: p_actor_kind/p_actor_id are IGNORED for authorization.
--   Role is derived from auth.uid() -> profiles.role.
--   Identity is auth.uid(). Parameters kept for backward compat only.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TRANSITION SCOPE: enforce per-role allowed transitions in RPC
--    Role derived from auth.uid(), NOT from p_actor_kind parameter.
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
  -- Derive identity and role from authenticated session, NEVER trust parameters
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

  SELECT id, order_id, status, shipped_at, delivered_at
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

  -- Per-role transition scope enforcement (based on VERIFIED role, not parameter)
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
    IF NOT (
      (v_ship.status = 'pronto_para_envio' AND p_new_status = 'enviado')
      OR (v_ship.status = 'enviado' AND p_new_status = 'entregue')
      OR (v_ship.status = 'pronto_para_retirada' AND p_new_status = 'entregue')
    ) THEN
      RETURN jsonb_build_object(
        'error', format('Operação não autorizada para role entregador: %s → %s', v_ship.status, p_new_status)
      );
    END IF;
  END IF;

  -- Update status + timestamps
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

  -- Log with verified role and identity, not client-supplied values
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
-- 2. OCCURRENCE TYPE SCOPING per actor_kind
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
  -- Derive identity and role from authenticated session, NEVER trust parameters
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

  -- Per-role occurrence type restriction (based on VERIFIED role, not parameter)
  IF v_actor_role = 'operacao' AND p_type NOT IN ('damage', 'note') THEN
    RETURN jsonb_build_object('error', format('Tipo ''%s'' não permitido para operação. Use: damage, note.', p_type));
  END IF;

  IF coalesce(trim(p_description), '') = '' THEN
    RETURN jsonb_build_object('error', 'Descrição obrigatória.');
  END IF;

  SELECT id, order_id INTO v_ship
    FROM order_shipments
   WHERE id = p_shipment_id;

  IF v_ship IS NULL THEN
    RETURN jsonb_build_object('error', 'Shipment não encontrado.');
  END IF;

  -- Use verified identity for logged_by, not client-supplied p_actor_id
  INSERT INTO shipment_occurrences (shipment_id, type, description, logged_by)
  VALUES (p_shipment_id, p_type, trim(p_description), v_caller_id)
  RETURNING id INTO v_occ_id;

  -- Log with verified role and identity
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
-- 3. ITEM PICK PERSISTENCE: picked_qty column on order_items
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS picked_qty int,
  ADD COLUMN IF NOT EXISTS picked_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.order_items.picked_qty IS 'Qty confirmed by separator. NULL = not yet picked.';
COMMENT ON COLUMN public.order_items.picked_at IS 'When this item was picked/confirmed.';
COMMENT ON COLUMN public.order_items.picked_by IS 'Who picked this item (profile_id).';

-- RPC: mark_item_picked — operacao marks one item as picked
-- Identity (picked_by) is ALWAYS auth.uid(), never client-supplied.
-- p_actor_id kept for backward compat but IGNORED.
CREATE OR REPLACE FUNCTION public.mark_item_picked(
  p_item_id    uuid,
  p_picked_qty int,
  p_actor_id   uuid default null
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_caller_id uuid;
  v_actor_role text;
BEGIN
  -- Derive identity from session, NEVER trust p_actor_id
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

  IF v_actor_role NOT IN ('operacao', 'admin') THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT oi.id, oi.order_id, oi.shipment_id, oi.qty, oi.name,
         os.status AS ship_status
    INTO v_item
    FROM order_items oi
    JOIN order_shipments os ON os.id = oi.shipment_id
   WHERE oi.id = p_item_id;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('error', 'Item não encontrado.');
  END IF;

  -- Only allow picking during preparando
  IF v_item.ship_status <> 'preparando' THEN
    RETURN jsonb_build_object('error', format('Shipment não está em separação (status: %s).', v_item.ship_status));
  END IF;

  IF p_picked_qty < 0 THEN
    RETURN jsonb_build_object('error', 'Quantidade não pode ser negativa.');
  END IF;

  -- Use auth.uid() for picked_by, never client-supplied ID
  UPDATE order_items
     SET picked_qty = p_picked_qty,
         picked_at  = now(),
         picked_by  = v_caller_id
   WHERE id = p_item_id;

  -- Log event with verified identity and role
  INSERT INTO order_events (order_id, type, data, actor_kind, actor_id, shipment_id)
  VALUES (
    v_item.order_id,
    'item_picked',
    jsonb_build_object(
      'item_id', p_item_id,
      'item_name', v_item.name,
      'expected_qty', v_item.qty,
      'picked_qty', p_picked_qty
    ),
    v_actor_role,
    v_caller_id,
    v_item.shipment_id
  );

  RETURN jsonb_build_object('ok', true, 'picked_qty', p_picked_qty);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. COLUMN-LEVEL SECURITY: revoke direct SELECT for operacao, use RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the direct-table RLS policies for operacao on orders and order_items.
-- Operacao will access data ONLY through SECURITY DEFINER RPCs.
-- order_shipments direct access also dropped — RPCs return joined data.

DROP POLICY IF EXISTS "operacao reads orders" ON public.orders;
DROP POLICY IF EXISTS "operacao reads order items" ON public.order_items;
DROP POLICY IF EXISTS "Shipments: operational reads all" ON public.order_shipments;
DROP POLICY IF EXISTS "Shipments: operational updates all" ON public.order_shipments;

-- Re-create shipment policies for admin-only direct access
-- (operacao goes through RPCs; admin keeps direct access)
CREATE POLICY "Shipments: admin reads all"
  ON public.order_shipments FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Shipments: admin updates all"
  ON public.order_shipments FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- RPC: separador_active_shipments — returns the queue with minimal columns
CREATE OR REPLACE FUNCTION public.separador_active_shipments()
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
  item_count bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['operacao']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT
    os.id,
    os.order_id,
    o.code::text                         AS order_code,
    split_part(o.customer->>'name', ' ', 1)::text AS customer_first_name,
    os.sequence,
    os.status::text,
    os.delivery_method::text,
    os.promised_from,
    os.promised_to,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.status IN ('aguardando_disponibilidade', 'preparando')
  ORDER BY os.promised_to ASC NULLS LAST, os.updated_at ASC;
END;
$$;

-- RPC: separador_recent_shipments — recently completed
CREATE OR REPLACE FUNCTION public.separador_recent_shipments(p_limit int default 10)
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
  item_count bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(ARRAY['operacao']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT
    os.id,
    os.order_id,
    o.code::text                         AS order_code,
    split_part(o.customer->>'name', ' ', 1)::text AS customer_first_name,
    os.sequence,
    os.status::text,
    os.delivery_method::text,
    os.promised_from,
    os.promised_to,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.status IN ('pronto_para_envio', 'pronto_para_retirada')
  ORDER BY os.updated_at DESC
  LIMIT p_limit;
END;
$$;

-- RPC: separador_shipment_detail — single shipment with items (safe columns only)
CREATE OR REPLACE FUNCTION public.separador_shipment_detail(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship record;
  v_items jsonb;
BEGIN
  IF NOT has_role(ARRAY['operacao']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT
    os.id, os.order_id, os.sequence, os.status, os.delivery_method,
    os.promised_from, os.promised_to, os.tracking_code, os.carrier,
    os.shipped_at, os.delivered_at, os.updated_at,
    o.code AS order_code,
    split_part(o.customer->>'name', ' ', 1) AS customer_first_name,
    o.address->>'district' AS address_district,
    o.address->>'reference' AS address_reference,
    o.notes
  INTO v_ship
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.id = p_shipment_id;

  IF v_ship IS NULL THEN
    RETURN jsonb_build_object('error', 'Shipment não encontrado.');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'name', oi.name,
      'sku', oi.sku,
      'image', oi.image,
      'unit', oi.unit,
      'qty', oi.qty,
      'picked_qty', oi.picked_qty,
      'picked_at', oi.picked_at
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
    'address_district', v_ship.address_district,
    'address_reference', v_ship.address_reference,
    'notes', v_ship.notes,
    'items', v_items
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Drop operacao INSERT/READ policies on occurrences — use RPC only
-- The log_shipment_occurrence RPC is SECURITY DEFINER, bypasses RLS.
-- Operacao reads occurrences through the detail RPC, not direct table access.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "operacao reads occurrences" ON public.shipment_occurrences;
DROP POLICY IF EXISTS "operacao inserts occurrences" ON public.shipment_occurrences;

-- RPC to read occurrences for a shipment (operacao-safe)
CREATE OR REPLACE FUNCTION public.separador_shipment_occurrences(p_shipment_id uuid)
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
BEGIN
  IF NOT has_role(ARRAY['operacao']) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT so.id, so.type::text, so.description, so.occurred_at
  FROM shipment_occurrences so
  WHERE so.shipment_id = p_shipment_id
  ORDER BY so.occurred_at DESC;
END;
$$;
