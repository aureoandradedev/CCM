-- 0003: Atomic stock reservation to prevent overselling.
--
-- create_order_atomic(order, items): single-transaction order creation (backend only)
-- release_order_stock(order):        return stock on cancel/expire     (admin only)
-- reserve_order_stock(order):        re-reserve on reopen              (admin only)

ALTER TABLE public.orders ADD COLUMN stock_reserved boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- create_order_atomic: reserves stock, generates code, inserts order + items
-- in a SINGLE PostgreSQL transaction. If anything fails, everything rolls back.
-- On creation_key race (unique_violation), stock rollback is automatic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order jsonb,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       record;
  cur_stock int;
  cur_name  text;
  new_code  text;
  new_id    uuid;
  result    jsonb;
BEGIN
  -- 1) Lock products in id-order (deadlock-safe), decrement stock
  PERFORM p.id
  FROM products p
  WHERE p.id IN (SELECT x->>'product_id' FROM jsonb_array_elements(p_items) x)
    AND p.stock IS NOT NULL
  ORDER BY p.id
  FOR UPDATE;

  FOR r IN
    SELECT x->>'product_id' AS pid, (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  LOOP
    UPDATE products SET stock = stock - r.qty
    WHERE id = r.pid AND stock IS NOT NULL AND stock >= r.qty;

    IF NOT FOUND THEN
      SELECT stock, name INTO cur_stock, cur_name FROM products WHERE id = r.pid;
      IF cur_stock IS NOT NULL THEN
        RAISE EXCEPTION 'insufficient_stock:%:disponivel=%:solicitado=%', cur_name, cur_stock, r.qty;
      END IF;
    END IF;
  END LOOP;

  -- 2) Generate order code
  new_code := next_order_code();

  -- 3) Insert order
  INSERT INTO orders (
    code, profile_id, customer, address,
    delivery_method, delivery_cep, delivery_date, delivery_window,
    notes, origin, payment_method, payment_status, order_status,
    retail_subtotal_centavos, subtotal_centavos, wholesale_savings_centavos,
    discount_centavos, discount_detail, freight_centavos, freight_rule,
    total_centavos, pricing_version, items_count, supplier_ids,
    creation_key, customer_hash, client_request_id, stock_reserved
  ) VALUES (
    new_code,
    NULLIF(p_order->>'profile_id', '')::uuid,
    p_order->'customer',
    p_order->'address',
    p_order->>'delivery_method',
    p_order->>'delivery_cep',
    (p_order->>'delivery_date')::date,
    p_order->>'delivery_window',
    p_order->>'notes',
    p_order->>'origin',
    p_order->>'payment_method',
    p_order->>'payment_status',
    p_order->>'order_status',
    (p_order->>'retail_subtotal_centavos')::int,
    (p_order->>'subtotal_centavos')::int,
    (p_order->>'wholesale_savings_centavos')::int,
    (p_order->>'discount_centavos')::int,
    p_order->'discount_detail',
    (p_order->>'freight_centavos')::int,
    p_order->>'freight_rule',
    (p_order->>'total_centavos')::int,
    (p_order->>'pricing_version')::int,
    (p_order->>'items_count')::int,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_order->'supplier_ids', '[]'::jsonb))),
    p_order->>'creation_key',
    p_order->>'customer_hash',
    p_order->>'client_request_id',
    true
  )
  RETURNING id INTO new_id;

  -- 4) Insert order items
  INSERT INTO order_items (
    order_id, product_id, supplier_id, name, sku, image,
    unit, qty, price_tier, unit_price_centavos,
    retail_price_centavos, line_centavos
  )
  SELECT
    new_id,
    x->>'product_id',
    NULLIF(x->>'supplier_id', ''),
    x->>'name',
    x->>'sku',
    x->>'image',
    x->>'unit',
    (x->>'qty')::int,
    x->>'price_tier',
    (x->>'unit_price_centavos')::int,
    (x->>'retail_price_centavos')::int,
    (x->>'line_centavos')::int
  FROM jsonb_array_elements(p_items) x;

  -- 5) Return created order
  SELECT jsonb_build_object(
    'id', o.id, 'code', o.code,
    'order_status', o.order_status, 'payment_status', o.payment_status,
    'pricing_version', o.pricing_version, 'total_centavos', o.total_centavos,
    'freight_centavos', o.freight_centavos, 'discount_centavos', o.discount_centavos,
    'subtotal_centavos', o.subtotal_centavos
  ) INTO result FROM orders o WHERE o.id = new_id;

  RETURN result;

EXCEPTION WHEN unique_violation THEN
  -- creation_key race: stock decrement auto-rolls back with the savepoint
  IF p_order->>'creation_key' IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', o.id, 'code', o.code,
      'order_status', o.order_status, 'payment_status', o.payment_status,
      'pricing_version', o.pricing_version, 'total_centavos', o.total_centavos,
      'freight_centavos', o.freight_centavos, 'discount_centavos', o.discount_centavos,
      'subtotal_centavos', o.subtotal_centavos,
      'reaproveitado', true
    ) INTO result FROM orders o WHERE o.creation_key = p_order->>'creation_key';
    IF result IS NOT NULL THEN RETURN result; END IF;
  END IF;
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- release_order_stock: returns stock for a specific order on cancel/expire.
-- Idempotent: UPDATE WHERE stock_reserved = true serialises concurrent calls.
-- ---------------------------------------------------------------------------
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

  UPDATE products p SET stock = p.stock + oi.qty
  FROM order_items oi
  WHERE oi.order_id = p_order_id
    AND p.id = oi.product_id
    AND p.stock IS NOT NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- reserve_order_stock: re-reserves stock when reopening a cancelled order.
-- Atomic UPDATE claim prevents concurrent double-reserve.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_order_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cur_stock int;
  cur_name  text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'acesso negado'; END IF;

  -- Atomic claim: only one concurrent caller proceeds
  UPDATE orders SET stock_reserved = true
  WHERE id = p_order_id AND stock_reserved = false;
  IF NOT FOUND THEN RETURN; END IF;

  -- Lock products in id-order, decrement
  PERFORM p.id
  FROM products p
  INNER JOIN order_items oi ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id AND p.stock IS NOT NULL
  ORDER BY p.id
  FOR UPDATE;

  FOR r IN
    SELECT oi.product_id AS pid, oi.qty
    FROM order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    UPDATE products SET stock = stock - r.qty
    WHERE id = r.pid AND stock IS NOT NULL AND stock >= r.qty;

    IF NOT FOUND THEN
      SELECT stock, name INTO cur_stock, cur_name FROM products WHERE id = r.pid;
      IF cur_stock IS NOT NULL THEN
        RAISE EXCEPTION 'insufficient_stock:%:disponivel=%:solicitado=%', cur_name, cur_stock, r.qty;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- create_order_atomic: backend-only (service_role)
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb) TO service_role;

-- release_order_stock: admin server actions (authenticated + is_admin() interna)
REVOKE ALL ON FUNCTION public.release_order_stock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_order_stock(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_order_stock(uuid) TO authenticated;

-- reserve_order_stock: admin server actions (authenticated + is_admin() interna)
REVOKE ALL ON FUNCTION public.reserve_order_stock(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_order_stock(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_order_stock(uuid) TO authenticated;
