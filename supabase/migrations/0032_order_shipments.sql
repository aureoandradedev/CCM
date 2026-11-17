-- 0032_order_shipments.sql
-- Multi-entrega Fase 1: order_shipments + extend create_order_atomic
-- Cada pedido pode ter N shipments (grupos de entrega).
-- Modelo 1P: cliente nunca vê fornecedor, apenas "Entrega 1", "Entrega 2".

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tabela order_shipments
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.order_shipments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  sequence         smallint not null,
  status           text not null default 'preparando'
                   check (status in (
                     'preparando',
                     'aguardando_disponibilidade',
                     'enviado',
                     'entregue',
                     'cancelado'
                   )),
  delivery_method  text not null default 'delivery',
  available_from   date,
  promised_from    date,
  promised_to      date,
  freight_centavos int not null default 0,
  tracking_code    text,
  carrier          text,
  shipped_at       timestamptz,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(order_id, sequence)
);

create index if not exists order_shipments_order_idx
  on public.order_shipments(order_id);

create trigger order_shipments_updated_at
  before update on public.order_shipments
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FK em order_items e order_events
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.order_items
  add column if not exists shipment_id uuid references public.order_shipments(id);

create index if not exists order_items_shipment_idx
  on public.order_items(shipment_id) where shipment_id is not null;

alter table public.order_events
  add column if not exists shipment_id uuid references public.order_shipments(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS: mesma política dos orders
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.order_shipments enable row level security;

create policy "Shipments: service_role full access"
  on public.order_shipments for all
  to service_role
  using (true)
  with check (true);

create policy "Shipments: authenticated read own orders"
  on public.order_shipments for select
  to authenticated
  using (
    order_id in (
      select id from public.orders where profile_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Backfill: 1 shipment por pedido existente
--    Mapeamento explícito de status do pedido → status do shipment
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  ship_status text;
  ship_id uuid;
begin
  for r in
    select id, order_status, delivery_method, freight_centavos
    from public.orders
    where not exists (
      select 1 from public.order_shipments s where s.order_id = orders.id
    )
    order by created_at
  loop
    -- Mapeamento explícito: order_status → shipment status
    case r.order_status
      when 'cancelado' then
        ship_status := 'cancelado';
      when 'separados' then
        ship_status := 'enviado';
      when 'pagos' then
        ship_status := 'entregue';
      when 'arquivados' then
        ship_status := 'entregue';
      else
        -- aguardando-pagamento, em-separacao, pagamento-pendente
        ship_status := 'preparando';
    end case;

    insert into public.order_shipments (
      order_id, sequence, status, delivery_method, freight_centavos
    ) values (
      r.id, 1, ship_status, coalesce(r.delivery_method, 'delivery'), coalesce(r.freight_centavos, 0)
    )
    returning id into ship_id;

    update public.order_items
      set shipment_id = ship_id
      where order_id = r.id;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Estender create_order_atomic com p_shipments
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order jsonb,
  p_items jsonb,
  p_shipments jsonb DEFAULT NULL
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
  ship_rec  jsonb;
  ship_id   uuid;
  default_ship_id uuid;
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

  -- 5) Insert shipments
  IF p_shipments IS NULL OR jsonb_array_length(p_shipments) = 0 THEN
    -- Backward compat: 1 shipment default contendo todos os itens
    INSERT INTO order_shipments (
      order_id, sequence, status, delivery_method, freight_centavos
    ) VALUES (
      new_id,
      1,
      'preparando',
      COALESCE(p_order->>'delivery_method', 'delivery'),
      COALESCE((p_order->>'freight_centavos')::int, 0)
    )
    RETURNING id INTO default_ship_id;

    UPDATE order_items SET shipment_id = default_ship_id
    WHERE order_id = new_id;
  ELSE
    FOR ship_rec IN SELECT value FROM jsonb_array_elements(p_shipments) AS value
    LOOP
      INSERT INTO order_shipments (
        order_id, sequence, status, delivery_method,
        available_from, promised_from, promised_to, freight_centavos
      ) VALUES (
        new_id,
        (ship_rec->>'sequence')::int,
        COALESCE(ship_rec->>'status', 'preparando'),
        COALESCE(ship_rec->>'delivery_method', p_order->>'delivery_method', 'delivery'),
        (ship_rec->>'available_from')::date,
        (ship_rec->>'promised_from')::date,
        (ship_rec->>'promised_to')::date,
        COALESCE((ship_rec->>'freight_centavos')::int, 0)
      )
      RETURNING id INTO ship_id;

      UPDATE order_items SET shipment_id = ship_id
      WHERE order_id = new_id
        AND product_id = ANY(
          ARRAY(SELECT jsonb_array_elements_text(ship_rec->'product_ids'))
        );
    END LOOP;

    -- Validação: nenhum item pode ficar sem shipment
    IF EXISTS (SELECT 1 FROM order_items WHERE order_id = new_id AND shipment_id IS NULL) THEN
      RAISE EXCEPTION 'orphan_items: itens sem shipment atribuido';
    END IF;
  END IF;

  -- 6) Return created order
  SELECT jsonb_build_object(
    'id', o.id, 'code', o.code,
    'order_status', o.order_status, 'payment_status', o.payment_status,
    'pricing_version', o.pricing_version, 'total_centavos', o.total_centavos,
    'freight_centavos', o.freight_centavos, 'discount_centavos', o.discount_centavos,
    'subtotal_centavos', o.subtotal_centavos,
    'shipments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'sequence', s.sequence,
        'promised_from', s.promised_from, 'promised_to', s.promised_to,
        'freight_centavos', s.freight_centavos, 'status', s.status
      ) ORDER BY s.sequence)
      FROM order_shipments s WHERE s.order_id = o.id
    ), '[]'::jsonb)
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

REVOKE EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(jsonb, jsonb, jsonb) TO service_role;
