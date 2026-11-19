-- 0052: Fix double stock return after partial confirmation.
-- Three functions used oi.qty (original) for stock return, but after partial
-- confirmation already returns qty - qty_confirmed, using the original qty
-- inflates stock. Fix: COALESCE(oi.qty_confirmed, oi.qty) returns only
-- the confirmed portion (or the full qty if no confirmation happened).

BEGIN;

-- 1. Fix release_order_stock (from 0003)
CREATE OR REPLACE FUNCTION public.release_order_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'acesso negado'; END IF;

  UPDATE orders SET stock_reserved = false
  WHERE id = p_order_id AND stock_reserved = true;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE products p SET stock = p.stock + COALESCE(oi.qty_confirmed, oi.qty)
  FROM order_items oi
  WHERE oi.order_id = p_order_id
    AND p.id = oi.product_id
    AND p.stock IS NOT NULL;
END;
$$;

-- 2. Fix cancel_order_full (from 0047)
CREATE OR REPLACE FUNCTION cancel_order_full(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_shipments_cancelled int := 0;
  v_requirements_removed int := 0;
  v_requirements_cancelled int := 0;
BEGIN
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT id, order_status, payment_status, stock_reserved
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado.');
  END IF;

  IF v_order.order_status = 'cancelado' THEN
    RETURN jsonb_build_object('error', 'Pedido já está cancelado.');
  END IF;

  IF v_order.payment_status = 'pago' THEN
    RETURN jsonb_build_object('error', 'Pedido pago: estorne primeiro, depois cancele.');
  END IF;

  IF v_order.stock_reserved THEN
    UPDATE products p
      SET stock = p.stock + COALESCE(oi.qty_confirmed, oi.qty)
      FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND p.id = oi.product_id
        AND p.stock IS NOT NULL;

    UPDATE orders
      SET stock_reserved = false
      WHERE id = p_order_id;
  END IF;

  UPDATE order_shipments
    SET status = 'cancelado',
        updated_at = now()
    WHERE order_id = p_order_id
      AND status NOT IN ('entregue', 'cancelado');
  GET DIAGNOSTICS v_shipments_cancelled = ROW_COUNT;

  DELETE FROM purchase_requirements
    WHERE source_order_id = p_order_id
      AND purchase_order_id IS NULL
      AND status IN ('pending', 'held');
  GET DIAGNOSTICS v_requirements_removed = ROW_COUNT;

  UPDATE purchase_requirements
    SET status = 'cancelled'
    WHERE source_order_id = p_order_id
      AND status <> 'cancelled';
  GET DIAGNOSTICS v_requirements_cancelled = ROW_COUNT;

  UPDATE orders
    SET order_status = 'cancelado'
    WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'shipments_cancelled', v_shipments_cancelled,
    'requirements_removed', v_requirements_removed,
    'requirements_cancelled', v_requirements_cancelled
  );
END;
$$;

-- 3. Fix customer_cancel_order (from 0049)
CREATE OR REPLACE FUNCTION customer_cancel_order(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_caller uuid := auth.uid();
  v_shipments_cancelled int := 0;
  v_requirements_removed int := 0;
  v_requirements_cancelled int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT id, order_status, payment_status, stock_reserved, profile_id
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado.');
  END IF;

  IF v_order.profile_id <> v_caller THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  IF v_order.order_status NOT IN ('aguardando-confirmacao', 'aguardando-pagamento') THEN
    RETURN jsonb_build_object('error', 'Este pedido não pode mais ser cancelado. Entre em contato conosco.');
  END IF;

  IF v_order.payment_status = 'pago' THEN
    RETURN jsonb_build_object('error', 'Pedido já pago. Entre em contato para solicitar estorno.');
  END IF;

  IF v_order.stock_reserved THEN
    UPDATE products p
      SET stock = p.stock + COALESCE(oi.qty_confirmed, oi.qty)
      FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND p.id = oi.product_id
        AND p.stock IS NOT NULL;

    UPDATE orders
      SET stock_reserved = false
      WHERE id = p_order_id;
  END IF;

  UPDATE order_shipments
    SET status = 'cancelado',
        updated_at = now()
    WHERE order_id = p_order_id
      AND status NOT IN ('entregue', 'cancelado');
  GET DIAGNOSTICS v_shipments_cancelled = ROW_COUNT;

  DELETE FROM purchase_requirements
    WHERE source_order_id = p_order_id
      AND purchase_order_id IS NULL
      AND status IN ('pending', 'held');
  GET DIAGNOSTICS v_requirements_removed = ROW_COUNT;

  UPDATE purchase_requirements
    SET status = 'cancelled'
    WHERE source_order_id = p_order_id
      AND status <> 'cancelled';
  GET DIAGNOSTICS v_requirements_cancelled = ROW_COUNT;

  UPDATE orders
    SET order_status = 'cancelado'
    WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'shipments_cancelled', v_shipments_cancelled,
    'requirements_removed', v_requirements_removed,
    'requirements_cancelled', v_requirements_cancelled
  );
END;
$$;

COMMIT;
