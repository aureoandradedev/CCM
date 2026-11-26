-- 0063: Fix entregador RPC overloads
--
-- Migration 0062 used CREATE OR REPLACE on entregador_active_shipments and
-- entregador_recent_shipments but changed their RETURNS TABLE signature
-- (12 → 15 columns). PostgreSQL does NOT replace a function when the return
-- type changes — it silently creates a second overload with the same name and
-- argument types. PostgREST then resolves the RPC call to the OLD 12-column
-- version, which filters by assigned_to = auth.uid() only (no admin path).
--
-- Fix: DROP both old and new overloads, then re-CREATE with the correct
-- 0062 definitions. entregador_shipment_detail and
-- entregador_shipment_occurrences did not change return type (jsonb and
-- TABLE(4 cols) respectively), but we drop+recreate them too for consistency.

-- ═══════════════════════════════════════════════════════════════════════════
-- DROP all overloads
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.entregador_active_shipments();
DROP FUNCTION IF EXISTS public.entregador_recent_shipments(int);
DROP FUNCTION IF EXISTS public.entregador_shipment_detail(uuid);
DROP FUNCTION IF EXISTS public.entregador_shipment_occurrences(uuid);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. entregador_active_shipments — admin sees ALL, entregador sees assigned
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.entregador_active_shipments()
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
  address_city text,
  item_count bigint,
  updated_at timestamptz,
  assigned_to uuid,
  assigned_to_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  v_is_admin := is_admin();
  IF NOT (v_is_admin OR has_role(ARRAY['entregador'])) THEN
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
    (o.address->>'city')::text                       AS address_city,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at,
    os.assigned_to,
    (SELECT coalesce(p.full_name, p.email)
     FROM profiles p WHERE p.id = os.assigned_to)::text AS assigned_to_name
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.status NOT IN ('entregue', 'cancelado')
    AND (v_is_admin OR os.assigned_to = auth.uid())
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. entregador_recent_shipments — admin sees ALL, entregador sees assigned
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.entregador_recent_shipments(p_limit int DEFAULT 10)
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
  address_city text,
  item_count bigint,
  updated_at timestamptz,
  assigned_to uuid,
  assigned_to_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  v_is_admin := is_admin();
  IF NOT (v_is_admin OR has_role(ARRAY['entregador'])) THEN
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
    (o.address->>'city')::text                       AS address_city,
    (SELECT count(*) FROM order_items oi WHERE oi.shipment_id = os.id) AS item_count,
    os.updated_at,
    os.assigned_to,
    (SELECT coalesce(p.full_name, p.email)
     FROM profiles p WHERE p.id = os.assigned_to)::text AS assigned_to_name
  FROM order_shipments os
  JOIN orders o ON o.id = os.order_id
  WHERE os.status IN ('entregue', 'cancelado')
    AND (v_is_admin OR os.assigned_to = auth.uid())
  ORDER BY os.updated_at DESC
  LIMIT p_limit;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. entregador_shipment_detail — admin can view any; entregador only assigned
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.entregador_shipment_detail(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship record;
  v_items jsonb;
  v_is_admin boolean;
BEGIN
  v_is_admin := is_admin();
  IF NOT (v_is_admin OR has_role(ARRAY['entregador'])) THEN
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

  -- entregador: must be assigned
  IF NOT v_is_admin THEN
    IF v_ship.assigned_to IS NULL OR v_ship.assigned_to <> auth.uid() THEN
      RETURN jsonb_build_object('error', 'Esta entrega não está atribuída a você.');
    END IF;
  END IF;

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
    'assigned_to', v_ship.assigned_to,
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. entregador_shipment_occurrences — admin can view any; entregador only assigned
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION public.entregador_shipment_occurrences(p_shipment_id uuid)
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
  v_is_admin boolean;
BEGIN
  v_is_admin := is_admin();
  IF NOT (v_is_admin OR has_role(ARRAY['entregador'])) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF NOT v_is_admin THEN
    SELECT os.assigned_to INTO v_assigned_to
      FROM order_shipments os
     WHERE os.id = p_shipment_id;

    IF v_assigned_to IS NULL OR v_assigned_to <> auth.uid() THEN
      RAISE EXCEPTION 'Esta entrega não está atribuída a você.';
    END IF;
  END IF;

  RETURN QUERY
  SELECT so.id, so.type::text, so.description, so.occurred_at
  FROM shipment_occurrences so
  WHERE so.shipment_id = p_shipment_id
  ORDER BY so.occurred_at DESC;
END;
$$;
