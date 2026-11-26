-- Migration 0061: Widen assign_shipment_driver + expose assigned_to to separador
--
-- Changes:
--   1. assign_shipment_driver: auth → is_admin() OR has_role(['operacao'])
--   2. assign_shipment_driver: block on terminal/in-transit statuses (enviado, entregue, cancelado)
--   3. separador_shipment_detail: add assigned_to to SELECT + jsonb output
--
-- This enables the separador (role=operacao) to assign a driver right after
-- finishing separation, without routing through the admin panel.

CREATE OR REPLACE FUNCTION public.assign_shipment_driver(
  p_shipment_id uuid,
  p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_driver record;
  v_shipment record;
BEGIN
  -- Auth: admin or operacao (separador)
  IF NOT (is_admin() OR has_role(ARRAY['operacao'])) THEN
    RAISE EXCEPTION 'Apenas administradores e operação podem atribuir entregadores.';
  END IF;

  -- Validate driver
  SELECT id, role, is_active INTO v_driver
  FROM public.profiles WHERE id = p_driver_id;

  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado.';
  END IF;

  IF v_driver.role <> 'entregador' THEN
    RAISE EXCEPTION 'Colaborador não possui perfil de entregador (role atual: %).', v_driver.role;
  END IF;

  IF NOT v_driver.is_active THEN
    RAISE EXCEPTION 'Entregador está inativo.';
  END IF;

  -- Validate shipment exists and is not in a blocked status
  SELECT id, status INTO v_shipment
  FROM public.order_shipments WHERE id = p_shipment_id;

  IF v_shipment IS NULL THEN
    RAISE EXCEPTION 'Shipment não encontrado.';
  END IF;

  IF v_shipment.status IN ('enviado', 'entregue', 'cancelado') THEN
    RAISE EXCEPTION 'Não é possível atribuir entregador em status "%".', v_shipment.status;
  END IF;

  UPDATE public.order_shipments
  SET assigned_to = p_driver_id
  WHERE id = p_shipment_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Patch separador_shipment_detail to expose assigned_to
-- ═══════════════════════════════════════════════════════════════════════════

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
    os.shipped_at, os.delivered_at, os.updated_at, os.assigned_to,
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
    'assigned_to', v_ship.assigned_to,
    'address_district', v_ship.address_district,
    'address_reference', v_ship.address_reference,
    'notes', v_ship.notes,
    'items', v_items
  );
END;
$$;
