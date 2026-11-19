-- 0047: Insert aguardando-confirmacao status between checkout and payment.
-- Every order now starts as aguardando-confirmacao; Compras confirms → aguardando-pagamento.
-- Also creates cancel_order_full RPC for consistent cancellation (stock + shipments + requirements).

BEGIN;

-- 1. Drop the old inline CHECK and add the new one with aguardando-confirmacao
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_status_check
  CHECK (order_status IN (
    'aguardando-confirmacao',
    'aguardando-pagamento',
    'em-separacao',
    'separados',
    'pagamento-pendente',
    'pagos',
    'arquivados',
    'cancelado'
  ));

-- 2. RPC: cancel_order_full
-- Atomically: releases stock, cancels non-terminal shipments, handles requirements safely.
-- SECURITY DEFINER + has_role guard (project pattern from 0041/0043/0046).
-- Requirements already consolidated into a PO (purchase_order_id IS NOT NULL) are
-- set to 'cancelled' but NOT deleted, preserving commercial traceability.
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
  -- RBAC: compras + admin only
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

  -- Release stock if reserved (inline to avoid is_admin guard in release_order_stock)
  IF v_order.stock_reserved THEN
    UPDATE products p
      SET stock = p.stock + oi.qty
      FROM order_items oi
      WHERE oi.order_id = p_order_id
        AND p.id = oi.product_id
        AND p.stock IS NOT NULL;

    UPDATE orders
      SET stock_reserved = false
      WHERE id = p_order_id;
  END IF;

  -- Cancel non-terminal shipments
  UPDATE order_shipments
    SET status = 'cancelado',
        updated_at = now()
    WHERE order_id = p_order_id
      AND status NOT IN ('entregue', 'cancelado');
  GET DIAGNOSTICS v_shipments_cancelled = ROW_COUNT;

  -- Requirements NOT yet in a PO (pending/held, no purchase_order_id): safe to delete
  DELETE FROM purchase_requirements
    WHERE source_order_id = p_order_id
      AND purchase_order_id IS NULL
      AND status IN ('pending', 'held');
  GET DIAGNOSTICS v_requirements_removed = ROW_COUNT;

  -- Requirements already consolidated into a PO: cancel but preserve for traceability
  UPDATE purchase_requirements
    SET status = 'cancelled'
    WHERE source_order_id = p_order_id
      AND status <> 'cancelled';
  GET DIAGNOSTICS v_requirements_cancelled = ROW_COUNT;

  -- Update order status
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

-- 3. RPC: confirm_order (Compras confirms an order, moving it out of aguardando-confirmacao)
-- na-entrega skips aguardando-pagamento (existing business rule: payment is cash on delivery,
-- no online payment flow exists for it; routing to aguardando-pagamento would deadlock).
CREATE OR REPLACE FUNCTION confirm_order(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_target text;
BEGIN
  -- RBAC: compras + admin only
  IF NOT has_role(ARRAY['compras']) THEN
    RETURN jsonb_build_object('error', 'Acesso negado.');
  END IF;

  SELECT id, order_status, payment_method
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado.');
  END IF;

  IF v_order.order_status <> 'aguardando-confirmacao' THEN
    RETURN jsonb_build_object('error', 'Pedido não está aguardando confirmação.');
  END IF;

  -- na-entrega = pay on delivery: no online payment, goes straight to separation
  IF v_order.payment_method = 'na-entrega' THEN
    v_target := 'em-separacao';
  ELSE
    v_target := 'aguardando-pagamento';
  END IF;

  UPDATE orders
    SET order_status = v_target
    WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'new_status', v_target);
END;
$$;

COMMIT;
