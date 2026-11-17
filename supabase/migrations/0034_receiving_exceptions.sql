-- 0034_receiving_exceptions.sql
-- Bloco 2: Recebimento no CD + Distribuição + Exceções Operacionais
-- Tabelas: receiving_sessions, receiving_items, operational_exceptions, exception_links

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. RECEIVING_SESSIONS — sessão de conferência de um pedido de compra
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.receiving_sessions (
  id                       uuid primary key default gen_random_uuid(),
  purchase_order_id        uuid not null references public.supplier_purchase_orders(id) on delete cascade,
  inspector_id             uuid references public.profiles(id),
  status                   text not null default 'in_progress'
                           check (status in ('in_progress', 'completed', 'cancelled')),
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  allocation_confirmed_at  timestamptz,
  notes                    text,
  created_at               timestamptz not null default now()
);

create index if not exists receiving_sessions_po_idx
  on public.receiving_sessions(purchase_order_id);

create index if not exists receiving_sessions_status_idx
  on public.receiving_sessions(status)
  where status = 'in_progress';

-- Garantia no banco: apenas UMA sessão ativa por PO (previne race condition no backend)
create unique index if not exists receiving_sessions_active_po_uniq
  on public.receiving_sessions(purchase_order_id)
  where status = 'in_progress';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RECEIVING_ITEMS — cada item conferido dentro de uma sessão
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.receiving_items (
  id                      uuid primary key default gen_random_uuid(),
  receiving_session_id    uuid not null references public.receiving_sessions(id) on delete cascade,
  purchase_order_item_id  uuid not null references public.purchase_order_items(id) on delete cascade,
  master_product_id       uuid not null references public.master_products(id) on delete cascade,
  expected_qty            int not null check (expected_qty > 0),
  received_qty            int not null default 0 check (received_qty >= 0),
  accepted_qty            int not null default 0 check (accepted_qty >= 0),
  damaged_qty             int not null default 0 check (damaged_qty >= 0),
  is_swapped              boolean not null default false,
  swapped_product_id      uuid references public.master_products(id),
  photos                  text[] default '{}',
  notes                   text,
  created_at              timestamptz not null default now(),
  constraint receiving_items_qty_check check (accepted_qty + damaged_qty <= received_qty)
);

create index if not exists receiving_items_session_idx
  on public.receiving_items(receiving_session_id);

create unique index if not exists receiving_items_session_poi_uniq
  on public.receiving_items(receiving_session_id, purchase_order_item_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. OPERATIONAL_EXCEPTIONS — exceções operacionais (shortage, damage, etc.)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.operational_exceptions (
  id                    uuid primary key default gen_random_uuid(),
  type                  text not null
                        check (type in ('shortage', 'damage', 'swap', 'excess', 'late_delivery', 'other')),
  receiving_session_id  uuid references public.receiving_sessions(id),
  supplier_id           text references public.suppliers(id),
  severity              text not null default 'medium'
                        check (severity in ('low', 'medium', 'high', 'critical')),
  resolution_status     text not null default 'open'
                        check (resolution_status in ('open', 'investigating', 'resolved', 'accepted')),
  resolution_notes      text,
  resolved_by           uuid references public.profiles(id),
  resolved_at           timestamptz,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  details               jsonb default '{}'
);

create index if not exists exceptions_status_idx
  on public.operational_exceptions(resolution_status)
  where resolution_status in ('open', 'investigating');

create index if not exists exceptions_supplier_idx
  on public.operational_exceptions(supplier_id)
  where supplier_id is not null;

create index if not exists exceptions_session_idx
  on public.operational_exceptions(receiving_session_id)
  where receiving_session_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. EXCEPTION_LINKS — vínculos estruturados (FKs reais, não só JSON)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exception_links (
  id                  uuid primary key default gen_random_uuid(),
  exception_id        uuid not null references public.operational_exceptions(id) on delete cascade,
  link_type           text not null
                      check (link_type in ('order', 'shipment', 'product', 'purchase_order')),
  order_id            uuid references public.orders(id),
  shipment_id         uuid references public.order_shipments(id),
  product_id          uuid references public.master_products(id),
  purchase_order_id   uuid references public.supplier_purchase_orders(id),
  created_at          timestamptz not null default now()
);

create index if not exists exception_links_exception_idx
  on public.exception_links(exception_id);

create index if not exists exception_links_order_idx
  on public.exception_links(order_id)
  where order_id is not null;

create index if not exists exception_links_shipment_idx
  on public.exception_links(shipment_id)
  where shipment_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS — todas as tabelas admin-only
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.receiving_sessions enable row level security;
alter table public.receiving_items enable row level security;
alter table public.operational_exceptions enable row level security;
alter table public.exception_links enable row level security;

-- service_role bypass
create policy "receiving_sessions: service_role full"
  on public.receiving_sessions for all
  to service_role using (true) with check (true);

create policy "receiving_items: service_role full"
  on public.receiving_items for all
  to service_role using (true) with check (true);

create policy "operational_exceptions: service_role full"
  on public.operational_exceptions for all
  to service_role using (true) with check (true);

create policy "exception_links: service_role full"
  on public.exception_links for all
  to service_role using (true) with check (true);

-- admin read/write (usa is_admin() existente — evita quoting issues com jsonb literal)
create policy "receiving_sessions: admin full"
  on public.receiving_sessions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "receiving_items: admin full"
  on public.receiving_items for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "operational_exceptions: admin full"
  on public.operational_exceptions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "exception_links: admin full"
  on public.exception_links for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Supabase Storage — bucket privado para fotos de recebimento
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recebimento',
  'recebimento',
  false,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage RLS: admin-only read/write
create policy "recebimento: admin upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recebimento'
    and public.is_admin()
  );

create policy "recebimento: admin read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recebimento'
    and public.is_admin()
  );

create policy "recebimento: admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recebimento'
    and public.is_admin()
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RPC: confirm_allocation_atomic — confirmação de alocação TRANSACIONAL
-- ═══════════════════════════════════════════════════════════════════════════
-- Garante:
--   • Idempotência: segunda chamada retorna erro, sem duplicação
--   • Atomicidade: tudo ou nada (plpgsql = single transaction)
--   • Race condition: SELECT FOR UPDATE trava a row da sessão
--   • Validação: alocações não excedem estoque recebido

create or replace function public.confirm_allocation_atomic(
  p_session_id  uuid,
  p_allocations jsonb,
  p_actor_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session         record;
  v_supplier_id     text;
  v_item            record;
  v_alloc_total     int;
  v_exc_id          uuid;
  v_shortage        int;
begin
  -- 1. Lock session row (prevents concurrent confirmations)
  select rs.id, rs.status, rs.purchase_order_id, rs.allocation_confirmed_at
  into v_session
  from receiving_sessions rs
  where rs.id = p_session_id
  for update;

  if not found then
    raise exception 'Sessão de recebimento não encontrada.'
      using hint = 'NOT_FOUND';
  end if;

  if v_session.status != 'completed' then
    raise exception 'Sessão não está completada (status: %).' , v_session.status
      using hint = 'BAD_STATUS';
  end if;

  -- Idempotency gate: already confirmed → error
  if v_session.allocation_confirmed_at is not null then
    raise exception 'Alocação já confirmada em %.' , v_session.allocation_confirmed_at
      using hint = 'ALREADY_CONFIRMED';
  end if;

  -- 2. Validate allocations don't exceed received stock
  for v_item in (
    select ri.master_product_id, ri.accepted_qty
    from receiving_items ri
    where ri.receiving_session_id = p_session_id
  ) loop
    select coalesce(sum((e->>'allocatedQty')::int), 0)
    into v_alloc_total
    from jsonb_array_elements(p_allocations) e
    where (e->>'masterProductId')::uuid = v_item.master_product_id;

    if v_alloc_total > v_item.accepted_qty then
      raise exception 'Conflito: alocação de % excede estoque recebido de % para produto %.',
        v_alloc_total, v_item.accepted_qty, v_item.master_product_id
        using hint = 'STOCK_CONFLICT';
    end if;
  end loop;

  -- 3. Mark as confirmed (idempotency gate persisted)
  update receiving_sessions
  set allocation_confirmed_at = now()
  where id = p_session_id;

  -- 4. Persist inventory (upsert ccm_inventory + insert movements)
  for v_item in (
    select ri.master_product_id, ri.accepted_qty
    from receiving_items ri
    where ri.receiving_session_id = p_session_id
      and ri.accepted_qty > 0
  ) loop
    insert into ccm_inventory (master_product_id, quantity, last_movement_at)
    values (v_item.master_product_id, v_item.accepted_qty, now())
    on conflict (master_product_id)
    do update set
      quantity = ccm_inventory.quantity + excluded.quantity,
      last_movement_at = now();

    insert into inventory_movements (
      master_product_id, movement_type, quantity,
      source_purchase_order_id, actor_id, reason
    ) values (
      v_item.master_product_id, 'receipt', v_item.accepted_qty,
      v_session.purchase_order_id, p_actor_id,
      'Recebimento sessão ' || p_session_id::text
    );
  end loop;

  -- 5. Get supplier_id for exceptions
  select spo.supplier_id into v_supplier_id
  from supplier_purchase_orders spo
  where spo.id = v_session.purchase_order_id;

  -- 6. Create exceptions for shortages and damages
  for v_item in (
    select ri.* from receiving_items ri where ri.receiving_session_id = p_session_id
  ) loop
    if v_item.expected_qty > v_item.received_qty then
      v_shortage := v_item.expected_qty - v_item.received_qty;

      insert into operational_exceptions (
        type, receiving_session_id, supplier_id, severity, created_by, details
      ) values (
        'shortage', p_session_id, v_supplier_id,
        case when v_shortage > v_item.expected_qty * 0.5 then 'high' else 'medium' end,
        p_actor_id,
        jsonb_build_object('expected', v_item.expected_qty, 'received', v_item.received_qty, 'shortage', v_shortage)
      )
      returning id into v_exc_id;

      insert into exception_links (exception_id, link_type, purchase_order_id)
      values (v_exc_id, 'purchase_order', v_session.purchase_order_id);
      insert into exception_links (exception_id, link_type, product_id)
      values (v_exc_id, 'product', v_item.master_product_id);
    end if;

    if v_item.damaged_qty > 0 then
      insert into operational_exceptions (
        type, receiving_session_id, supplier_id, severity, created_by, details
      ) values (
        'damage', p_session_id, v_supplier_id,
        case when v_item.damaged_qty > v_item.expected_qty * 0.3 then 'high' else 'medium' end,
        p_actor_id,
        jsonb_build_object('damaged', v_item.damaged_qty, 'total_received', v_item.received_qty)
      )
      returning id into v_exc_id;

      insert into exception_links (exception_id, link_type, purchase_order_id)
      values (v_exc_id, 'purchase_order', v_session.purchase_order_id);
      insert into exception_links (exception_id, link_type, product_id)
      values (v_exc_id, 'product', v_item.master_product_id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'sessionId', p_session_id, 'inventoryUpdated', true);
end;
$$;

revoke all on function public.confirm_allocation_atomic from public;
revoke all on function public.confirm_allocation_atomic from anon;
grant execute on function public.confirm_allocation_atomic to service_role;
