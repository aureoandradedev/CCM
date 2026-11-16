-- ============================================================================
-- CCM · Migration 0025 — Snapshot de fornecedor em order_items
-- ============================================================================
--
-- Adiciona colunas de rastreabilidade ao order_items para que cada venda
-- registre o custo do fornecedor, a oferta e o master product NO MOMENTO
-- DA VENDA. Sem isso, o BI por fornecedor não consegue calcular margem
-- nem atribuir vendas históricas com precisão quando sourcing muda.
--
-- Colunas:
--   supplier_cost_centavos  — custo de compra do CCM naquele item
--   supplier_offer_id       — oferta ativa no momento
--   master_product_id       — produto mestre CCM
--
-- Pedidos antigos ficam com NULL nesses campos.
-- O BI mostra aviso "dados de margem disponíveis a partir de [data]".
--
-- A RPC create_order_atomic é atualizada para receber esses campos.
-- ============================================================================

-- ============================================================================
-- 1. NOVAS COLUNAS EM order_items
-- ============================================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS supplier_cost_centavos int,
  ADD COLUMN IF NOT EXISTS supplier_offer_id      uuid REFERENCES public.supplier_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS master_product_id      uuid REFERENCES public.master_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_items_supplier_idx
  ON public.order_items (supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_items_master_product_idx
  ON public.order_items (master_product_id)
  WHERE master_product_id IS NOT NULL;

COMMENT ON COLUMN public.order_items.supplier_cost_centavos IS
  'Custo de compra (centavos) do fornecedor no momento da venda. NULL = pedidos antigos sem snapshot.';

COMMENT ON COLUMN public.order_items.supplier_offer_id IS
  'Oferta do fornecedor ativa no momento da venda. NULL = pedidos antigos sem snapshot.';

COMMENT ON COLUMN public.order_items.master_product_id IS
  'Produto mestre CCM associado ao item no momento da venda. NULL = pedidos antigos ou produto sem master.';

-- ============================================================================
-- 2. ATUALIZAR create_order_atomic para receber os novos campos
-- ============================================================================

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

  -- 4) Insert order items (with supplier snapshot columns)
  INSERT INTO order_items (
    order_id, product_id, supplier_id, name, sku, image,
    unit, qty, price_tier, unit_price_centavos,
    retail_price_centavos, line_centavos,
    supplier_cost_centavos, supplier_offer_id, master_product_id
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
    (x->>'line_centavos')::int,
    (x->>'supplier_cost_centavos')::int,
    NULLIF(x->>'supplier_offer_id', '')::uuid,
    NULLIF(x->>'master_product_id', '')::uuid
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

-- Permissions stay the same: backend-only (service_role)
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.create_order_atomic(jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb) TO service_role;
